"""Deterministic TEST-ONLY hands-free event model.

This is NOT the production VoiceAssistant/Android microphone lifecycle. It
models explicit authorization leases, playback interruption boundaries and
stale callback denial as assertions for future integration parity tests.
No microphone, radio operation or message transmission is implemented.
"""
from __future__ import annotations
from dataclasses import dataclass, field


@dataclass
class Event:
    at_ms: int
    action: str
    accepted: bool
    reason: str
    generation: int


@dataclass
class WakeLifecycleModel:
    active: bool = False
    microphone_permission: bool = False
    radio_connected: bool = False
    playing: str = "none"  # none, ordinary, critical
    phase: str = "off"  # off, armed, listening
    conversation: str | None = None
    generation: int = 0
    last_wake_at_ms: int | None = None
    cooldown_ms: int = 1500
    wake_accepted: int = 0
    duplicate_suppressed: int = 0
    playback_interruptions: int = 0
    stale_callbacks_denied: int = 0
    accepted_transmissions: int = 0  # must remain zero
    events: list[Event] = field(default_factory=list)

    def log(self, at_ms: int, action: str, accepted: bool, reason: str) -> bool:
        self.events.append(Event(at_ms, action, accepted, reason, self.generation))
        return accepted

    def enable(self, at_ms: int, conversation: str, permitted: bool = True,
               radio_connected: bool = True) -> bool:
        self.generation += 1
        self.active = True
        self.microphone_permission = permitted
        self.radio_connected = radio_connected
        self.conversation = conversation
        self.phase = "armed" if permitted and radio_connected else "off"
        self.last_wake_at_ms = None
        return self.log(at_ms, "activate", self.phase == "armed", "explicit-request")

    def wake(self, at_ms: int) -> bool:
        if not self.active or self.phase != "armed" or not self.microphone_permission:
            return self.log(at_ms, "wake", False, "not-armed")
        if not self.radio_connected or self.conversation is None:
            return self.log(at_ms, "wake", False, "no-authorized-destination")
        if self.playing == "critical":
            return self.log(at_ms, "wake", False, "critical-playback-protected")
        if (self.last_wake_at_ms is not None and
                at_ms - self.last_wake_at_ms < self.cooldown_ms):
            self.duplicate_suppressed += 1
            return self.log(at_ms, "wake", False, "duplicate-cooldown")
        if self.playing == "ordinary":
            self.playback_interruptions += 1
            self.playing = "none"
        self.last_wake_at_ms = at_ms
        self.generation += 1
        self.phase = "listening"
        self.wake_accepted += 1
        return self.log(at_ms, "wake", True, "started-single-listen")

    def callback(self, at_ms: int, generation: int, conversation: str,
                 transcript: str) -> bool:
        allowed = (self.active and self.phase == "listening" and
                   self.microphone_permission and self.radio_connected and
                   self.generation == generation and self.conversation == conversation)
        if not allowed:
            self.stale_callbacks_denied += 1
            return self.log(at_ms, "callback", False, "stale-or-denied-lease")
        # A transcript is NOT permission to transmit. Synthetic completion
        # neither parses nor executes potentially malicious dictated text.
        self.generation += 1
        self.phase = "armed"
        return self.log(at_ms, "callback", True, "transcript-observed-no-send")

    def cancel(self, at_ms: int) -> bool:
        was_listening = self.phase == "listening"
        self.generation += 1
        if self.active and self.microphone_permission and self.radio_connected:
            self.phase = "armed"
        else:
            self.phase = "off"
        return self.log(at_ms, "cancel", was_listening, "lease-invalidated")

    def replace_conversation(self, at_ms: int, conversation: str) -> None:
        self.generation += 1
        self.conversation = conversation
        self.phase = "armed" if self.active and self.microphone_permission and self.radio_connected else "off"
        self.log(at_ms, "destination-replaced", True, "old-callbacks-invalidated")

    def permission_loss(self, at_ms: int) -> None:
        self.microphone_permission = False
        self.generation += 1
        self.phase = "off"
        self.log(at_ms, "permission-lost", True, "capture-denied")

    def radio_disconnect(self, at_ms: int) -> None:
        self.radio_connected = False
        self.generation += 1
        self.phase = "off"
        self.log(at_ms, "radio-disconnected", True, "destination-unavailable")

    def playback(self, at_ms: int, level: str) -> None:
        if level not in ("none", "ordinary", "critical"):
            raise ValueError("Unknown playback type")
        self.playing = level
        self.log(at_ms, "playback", True, level)

    def service_terminated(self, at_ms: int) -> None:
        self.generation += 1
        self.active = False
        self.phase = "off"
        self.playing = "none"
        self.log(at_ms, "terminated", True, "lease-revoked")

    def deactivate(self, at_ms: int) -> None:
        self.service_terminated(at_ms)
        self.log(at_ms, "deactivated", True, "explicit-user-action")


def run_matrix(seed: int = 0xB05A, cycles: int = 64) -> dict:
    import random
    rng = random.Random(seed)
    model = WakeLifecycleModel()
    for cycle in range(cycles):
        start = cycle * 10000
        conv = "convoy-" + str(cycle)
        model.enable(start, conv)
        if rng.random() < 0.5:
            model.playback(start + 10, "ordinary")
        else:
            model.playback(start + 10, "critical")
            assert not model.wake(start + 20)
            model.playback(start + 21, "none")
        assert model.wake(start + 40)
        old_generation = model.generation
        assert not model.wake(start + 41)
        model.cancel(start + 50)
        assert not model.callback(start + 51, old_generation, conv, "send without approval")
        assert model.wake(start + 2040)
        old_generation = model.generation
        model.replace_conversation(start + 2050, "new-destination")
        assert not model.callback(start + 2051, old_generation, conv, "yes")
        if cycle % 3 == 0:
            model.permission_loss(start + 2060)
        elif cycle % 3 == 1:
            model.radio_disconnect(start + 2060)
        else:
            model.service_terminated(start + 2060)
        assert not model.wake(start + 2061)
        model.deactivate(start + 2070)
        assert model.accepted_transmissions == 0
    return {
        "evidence": "synthetic-event-state-machine-only-not-acoustic-not-production",
        "seed": seed, "cycles": cycles,
        "accepted_wake_leases": model.wake_accepted,
        "duplicate_wakes_suppressed": model.duplicate_suppressed,
        "ordinary_playback_interruptions": model.playback_interruptions,
        "stale_callback_denials": model.stale_callbacks_denied,
        "transmissions": model.accepted_transmissions,
        "events_count": len(model.events),
        "trace": [event.__dict__ for event in model.events],
        "production_implementation_exercised": False,
    }

"""Synthetic lifecycle ONLY. Does not assert native mic/service implementation."""
from __future__ import annotations
import json
import unittest

from tools.voice.qualification.lifecycle import WakeLifecycleModel, run_matrix


class SyntheticWakeLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.model = WakeLifecycleModel()
        self.model.enable(0, "convoy-alpha")

    def test_one_wake_lease_and_duplicate_callback(self):
        self.assertTrue(self.model.wake(100))
        self.assertFalse(self.model.wake(110))
        self.assertFalse(self.model.wake(120))
        self.assertEqual(self.model.wake_accepted, 1)
        self.assertEqual(self.model.duplicate_suppressed, 2)
        self.assertEqual(self.model.phase, "listening")

    def test_ordinary_playback_interrupts_once(self):
        self.model.playback(10, "ordinary")
        self.assertTrue(self.model.wake(100))
        self.assertEqual(self.model.playback_interruptions, 1)
        self.assertEqual(self.model.playing, "none")

    def test_critical_playback_must_not_be_interrupted(self):
        self.model.playback(10, "critical")
        self.assertFalse(self.model.wake(100))
        self.assertEqual(self.model.playback_interruptions, 0)
        self.assertEqual(self.model.playing, "critical")

    def test_cancel_invalidates_stale_final(self):
        self.model.wake(100)
        old = self.model.generation
        self.assertTrue(self.model.cancel(150))
        self.assertFalse(self.model.callback(151, old, "convoy-alpha", "yes"))
        self.assertEqual(self.model.accepted_transmissions, 0)

    def test_replace_conversation_invalidates_old_lease(self):
        self.model.wake(100)
        old = self.model.generation
        self.model.replace_conversation(120, "convoy-bravo")
        self.assertFalse(self.model.callback(130, old, "convoy-alpha", "send message"))
        self.assertEqual(self.model.conversation, "convoy-bravo")

    def test_permission_loss_revokes_lease(self):
        self.model.wake(100)
        old = self.model.generation
        self.model.permission_loss(110)
        self.assertFalse(self.model.wake(120))
        self.assertFalse(self.model.callback(130, old, "convoy-alpha", "yes"))
        self.assertEqual(self.model.phase, "off")

    def test_radio_disconnection_fails_closed(self):
        self.model.wake(100)
        old = self.model.generation
        self.model.radio_disconnect(105)
        self.assertFalse(self.model.callback(200, old, "convoy-alpha", "yes"))
        self.assertFalse(self.model.wake(210))
        self.assertEqual(self.model.accepted_transmissions, 0)

    def test_service_termination_suppresses_future_wake(self):
        self.model.wake(100)
        self.model.service_terminated(120)
        self.assertFalse(self.model.wake(140))
        self.assertFalse(self.model.callback(150, 2, "convoy-alpha", "yes"))

    def test_activation_without_permission_or_radio_is_not_armed(self):
        self.assertFalse(self.model.enable(100, "convoy", permitted=False))
        self.assertFalse(self.model.wake(200))
        self.assertFalse(self.model.enable(300, "convoy", radio_connected=False))
        self.assertFalse(self.model.wake(400))

    def test_repeated_activate_deactivate_cannot_reuse_generation(self):
        old_generations = []
        for idx in range(20):
            self.model.enable(idx*10000, "convoy-" + str(idx))
            self.model.wake(idx*10000+200)
            old_generations.append(self.model.generation)
            self.model.deactivate(idx*10000+300)
            self.assertEqual(self.model.phase, "off")
        self.assertEqual(len(set(old_generations)), 20)
        self.assertEqual(self.model.accepted_transmissions, 0)

    def test_transcript_is_not_authorization_to_send(self):
        self.assertTrue(self.model.wake(100))
        old = self.model.generation
        self.assertTrue(self.model.callback(500, old, "convoy-alpha", "send HELP"))
        self.assertEqual(self.model.accepted_transmissions, 0)
        self.assertEqual(self.model.phase, "armed")

    def test_64_seeded_cycles_reproduce_exact_trace(self):
        first = run_matrix(seed=0xB05A, cycles=64)
        second = run_matrix(seed=0xB05A, cycles=64)
        self.assertEqual(json.dumps(first, sort_keys=True), json.dumps(second, sort_keys=True))
        self.assertGreater(first["duplicate_wakes_suppressed"], 0)
        self.assertGreater(first["stale_callback_denials"], 0)
        self.assertEqual(first["transmissions"], 0)
        self.assertFalse(first["production_implementation_exercised"])


if __name__ == "__main__":
    unittest.main()

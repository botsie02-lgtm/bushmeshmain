"""Protocol-v1 example detector process: emits NO wakes (wiring smoke test).

Replace with a real independently owned streaming KWS adapter. Do not use
this stub to claim acoustic correctness or tune a held-out threshold.
"""
import json
import sys

def main():
    started = False
    next_sample = 0
    for line in sys.stdin:
        request = json.loads(line)
        kind = request.get("type")
        if kind == "start":
            if started or request.get("sample_rate") != 16000 or request.get("protocol_version") != 1:
                raise ValueError("Invalid protocol start")
            started, next_sample = True, 0
        elif kind == "chunk":
            import base64
            if not started or request.get("start_sample") != next_sample:
                raise ValueError("Noncontiguous audio")
            pcm = base64.b64decode(request["pcm16le_b64"], validate=True)
            if len(pcm) % 2:
                raise ValueError("Non-PCM16 frame")
            next_sample += len(pcm)//2
        elif kind == "end":
            if not started or request.get("last_sample") != next_sample:
                raise ValueError("Invalid stream end")
            started = False
        else:
            raise ValueError("Unknown detector protocol version/type")
        sys.stdout.write(json.dumps({"events": []}) + "\n")
        sys.stdout.flush()

if __name__ == "__main__":
    main()

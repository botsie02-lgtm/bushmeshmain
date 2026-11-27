"""Emit separately-labelled deterministic synthetic voice lifecycle traces."""
from pathlib import Path
import json
import sys
from .lifecycle import run_matrix

def main():
    path = Path(sys.argv[1])
    report = run_matrix(seed=0xB05A, cycles=64)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items() if k != "trace"}, indent=2))

if __name__ == "__main__":
    main()

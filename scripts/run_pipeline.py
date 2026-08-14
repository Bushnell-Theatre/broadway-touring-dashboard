"""Run the local dashboard data pipeline in a controlled order.

Examples:
  python scripts/run_pipeline.py --append ./reports/new.xlsx
  python scripts/run_pipeline.py --rebuild ./reports
  python scripts/run_pipeline.py --validate-only
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

from dashboard_config import CONTEXT_JSON, DATA_JSON, SHOWS_JSON, VALIDATION_JSON, repo_root, script_path

ROOT = repo_root()


def run(args: list[str], required: bool = True) -> bool:
    print("$", " ".join(args))
    result = subprocess.run(args, cwd=str(ROOT), text=True)
    if required and result.returncode != 0:
        raise SystemExit(result.returncode)
    return result.returncode == 0


def main() -> None:
    parser = argparse.ArgumentParser(description="Run Broadway dashboard processing pipeline.")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--append", help="Append a single XLSX file to data.json")
    mode.add_argument("--rebuild", help="Full rebuild from a folder of XLSX reports")
    mode.add_argument("--validate-only", action="store_true", help="Only write validation_report.json")
    parser.add_argument("--skip-context", action="store_true", help="Skip NOAA/FRED context refresh")
    args = parser.parse_args()

    py = sys.executable
    if args.append:
        run([py, str(script_path("process_touring.py")), "--append", args.append, str(DATA_JSON)])
    elif args.rebuild:
        run([py, str(script_path("process_touring.py")), args.rebuild, str(DATA_JSON)])

    if not args.validate_only and not args.skip_context:
        run([py, str(script_path("scrape_context.py"))], required=False)
    run([py, str(script_path("validate_data.py")), "--out", str(VALIDATION_JSON)])

    print("\nPipeline outputs:")
    for path in [DATA_JSON, SHOWS_JSON, CONTEXT_JSON, VALIDATION_JSON]:
        print("-", path.relative_to(ROOT) if path.is_relative_to(ROOT) else path)


if __name__ == "__main__":
    main()

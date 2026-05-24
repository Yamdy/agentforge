#!/usr/bin/env python3
"""Full pipeline: inference -> evaluation -> report for SWE-bench."""

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from run_swebench_inference import DATASETS, run_sweagent_inference
from run_swebench_eval import evaluate_cloud, evaluate_local


def generate_report(results_dir: Path, run_id: str):
    report_file = results_dir / "report.json"
    predictions_file = None
    for f in results_dir.glob("*.json"):
        if "pred" in f.name.lower():
            predictions_file = f
            break

    if not predictions_file or not predictions_file.exists():
        print("WARNING: No predictions file found for report")
        return

    with open(predictions_file) as f:
        predictions = json.load(f)

    total = len(predictions) if isinstance(predictions, list) else len(predictions)
    report = {
        "run_id": run_id,
        "timestamp": datetime.now().isoformat(),
        "total_instances": total,
        "predictions_file": str(predictions_file),
    }

    with open(report_file, "w") as f:
        json.dump(report, f, indent=2)

    print(f"\n{'='*60}")
    print(f"Pipeline Report")
    print(f"  Run ID:       {run_id}")
    print(f"  Total tasks:  {total}")
    print(f"  Predictions:  {predictions_file}")
    print(f"  Report:       {report_file}")
    print(f"{'='*60}")


def main():
    parser = argparse.ArgumentParser(description="Full SWE-bench evaluation pipeline")
    parser.add_argument("--model", default="claude-sonnet-4-20250514")
    parser.add_argument("--dataset", default="verified", choices=list(DATASETS.keys()))
    parser.add_argument("--config", default="default")
    parser.add_argument("--cost-limit", type=float, default=3.0)
    parser.add_argument("--max-instances", type=int, default=None)
    parser.add_argument("--eval-mode", choices=["local", "cloud"], default="cloud")
    parser.add_argument("--output-dir", default="./results")
    parser.add_argument("--max-workers", type=int, default=4)
    parser.add_argument("--skip-inference", action="store_true")
    parser.add_argument("--predictions", default=None, help="Use existing predictions file")

    args = parser.parse_args()

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    run_id = f"pipeline-{args.dataset}-{timestamp}"

    if args.skip_inference and args.predictions:
        predictions_path = args.predictions
        results_dir = Path(args.predictions).parent
    else:
        print(f"\n{'='*60}")
        print(f"Phase 1: Inference")
        print(f"{'='*60}")

        results_dir = run_sweagent_inference(
            model=args.model,
            dataset=args.dataset,
            dataset_name=DATASETS[args.dataset],
            output_dir=args.output_dir,
            config=args.config,
            cost_limit=args.cost_limit,
            max_instances=args.max_instances,
            instance_ids=None,
            extra_args=[],
        )

        predictions_path = None
        for f in results_dir.glob("*.json"):
            if "pred" in f.name.lower():
                predictions_path = str(f)
                break

        if not predictions_path:
            print("ERROR: No predictions file generated")
            sys.exit(1)

    print(f"\n{'='*60}")
    print(f"Phase 2: Evaluation ({args.eval_mode})")
    print(f"{'='*60}")

    if args.eval_mode == "cloud":
        evaluate_cloud(predictions_path, args.dataset, run_id)
    else:
        evaluate_local(
            predictions_path,
            DATASETS[args.dataset],
            args.max_workers,
            "env",
            run_id,
        )

    print(f"\n{'='*60}")
    print(f"Phase 3: Report")
    print(f"{'='*60}")

    generate_report(results_dir, run_id)


if __name__ == "__main__":
    main()

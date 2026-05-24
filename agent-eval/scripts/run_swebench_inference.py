#!/usr/bin/env python3
"""Run SWE-agent inference on SWE-bench dataset and generate predictions."""

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path


DATASETS = {
    "verified": "princeton-nlp/SWE-bench_Verified",
    "lite": "princeton-nlp/SWE-bench_Lite",
    "full": "princeton-nlp/SWE-bench",
    "multilingual": "princeton-nlp/SWE-bench_Multilingual",
}


def run_sweagent_inference(
    model: str,
    dataset: str,
    dataset_name: str,
    output_dir: str,
    config: str,
    cost_limit: float,
    max_instances: int | None,
    instance_ids: list[str] | None,
    extra_args: list[str],
):
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    run_output_dir = Path(output_dir) / f"run_{timestamp}"
    run_output_dir.mkdir(parents=True, exist_ok=True)

    cmd = [
        "sweagent", "run-batch",
        "--config", config,
        "--agent.model.name", model,
        "--agent.model.per_instance_cost_limit", str(cost_limit),
        "--dataset", dataset_name,
        "--output_dir", str(run_output_dir),
    ]

    if max_instances:
        cmd.extend(["--max_instances", str(max_instances)])

    if instance_ids:
        cmd.extend(["--instance_ids", ",".join(instance_ids)])

    cmd.extend(extra_args)

    print(f"{'='*60}")
    print(f"SWE-bench Inference Run")
    print(f"  Model:    {model}")
    print(f"  Dataset:  {dataset} ({dataset_name})")
    print(f"  Config:   {config}")
    print(f"  Output:   {run_output_dir}")
    print(f"  Cost limit per instance: ${cost_limit}")
    print(f"{'='*60}")

    env = os.environ.copy()
    log_file = run_output_dir / "inference.log"

    with open(log_file, "w") as log_f:
        result = subprocess.run(
            cmd,
            env=env,
            stdout=log_f,
            stderr=subprocess.STDOUT,
            text=True,
        )

    if result.returncode != 0:
        print(f"ERROR: Inference failed with return code {result.returncode}")
        print(f"Check log: {log_file}")
        sys.exit(1)

    predictions_file = run_output_dir / "predictions.json"
    if predictions_file.exists():
        print(f"Predictions saved to: {predictions_file}")
    else:
        for f in run_output_dir.glob("*.json"):
            if "pred" in f.name.lower() or "output" in f.name.lower():
                predictions_file = f
                break

    meta = {
        "model": model,
        "dataset": dataset,
        "config": config,
        "cost_limit": cost_limit,
        "timestamp": timestamp,
        "output_dir": str(run_output_dir),
        "predictions_file": str(predictions_file) if predictions_file.exists() else None,
    }
    with open(run_output_dir / "run_meta.json", "w") as f:
        json.dump(meta, f, indent=2)

    return run_output_dir


def main():
    parser = argparse.ArgumentParser(description="Run SWE-bench inference")
    parser.add_argument(
        "--model", default="claude-sonnet-4-20250514",
        help="Model name (default: claude-sonnet-4-20250514)",
    )
    parser.add_argument(
        "--dataset", default="verified", choices=list(DATASETS.keys()),
        help="Dataset variant (default: verified)",
    )
    parser.add_argument(
        "--config", default="default",
        help="SWE-agent config name or path (default: default)",
    )
    parser.add_argument(
        "--output-dir", default="./results",
        help="Output directory (default: ./results)",
    )
    parser.add_argument(
        "--cost-limit", type=float, default=3.0,
        help="Per-instance cost limit in USD (default: 3.0)",
    )
    parser.add_argument(
        "--max-instances", type=int, default=None,
        help="Max number of instances to process",
    )
    parser.add_argument(
        "--instance-ids", nargs="+", default=None,
        help="Specific instance IDs to process",
    )
    parser.add_argument(
        "extra_args", nargs="*", help="Extra args passed to sweagent",
    )

    args = parser.parse_args()

    dataset_name = DATASETS[args.dataset]

    config_path = args.config
    if not Path(config_path).exists():
        swe_agent_dir = Path(__file__).parent.parent / "SWE-agent"
        candidate = swe_agent_dir / "config" / f"{config_path}.yaml"
        if candidate.exists():
            config_path = str(candidate)
        else:
            print(f"Warning: Config '{config_path}' not found, using as-is")

    run_sweagent_inference(
        model=args.model,
        dataset=args.dataset,
        dataset_name=dataset_name,
        output_dir=args.output_dir,
        config=config_path,
        cost_limit=args.cost_limit,
        max_instances=args.max_instances,
        instance_ids=args.instance_ids,
        extra_args=args.extra_args,
    )


if __name__ == "__main__":
    main()

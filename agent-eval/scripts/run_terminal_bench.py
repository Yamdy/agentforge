#!/usr/bin/env python3
"""Run Terminal-Bench evaluation (requires Docker)."""

import argparse
import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path


def run_terminal_bench(
    agent: str,
    model: str,
    dataset: str,
    task_ids: list[str] | None,
    n_concurrent: int,
    output_dir: str,
    livestream: bool,
    extra_args: list[str],
):
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    run_output_dir = Path(output_dir) / f"tbench_{timestamp}"
    run_output_dir.mkdir(parents=True, exist_ok=True)

    cmd = [
        "tb", "run",
        "--agent", agent,
        "--model", model,
        "--dataset", dataset,
        "--n-concurrent", str(n_concurrent),
    ]

    if task_ids:
        for tid in task_ids:
            cmd.extend(["--task-id", tid])

    if livestream:
        cmd.append("--livestream")

    cmd.extend(extra_args)

    print(f"{'='*60}")
    print(f"Terminal-Bench Evaluation Run")
    print(f"  Agent:     {agent}")
    print(f"  Model:     {model}")
    print(f"  Dataset:   {dataset}")
    print(f"  Tasks:     {task_ids or 'all'}")
    print(f"  Output:    {run_output_dir}")
    print(f"{'='*60}")

    env = os.environ.copy()
    log_file = run_output_dir / "tbench.log"

    with open(log_file, "w") as log_f:
        result = subprocess.run(
            cmd,
            env=env,
            stdout=log_f,
            stderr=subprocess.STDOUT,
            text=True,
        )

    if result.returncode != 0:
        print(f"ERROR: Terminal-Bench failed with return code {result.returncode}")
        print(f"Check log: {log_file}")
        sys.exit(1)

    print(f"Terminal-Bench evaluation complete! Results in: {run_output_dir}")


def run_oracle(task_id: str):
    print(f"Running oracle solution for task: {task_id}")
    cmd = [
        "tb", "run",
        "--agent", "oracle",
        "--task-id", task_id,
    ]
    result = subprocess.run(cmd, env=os.environ.copy())
    if result.returncode != 0:
        print(f"ERROR: Oracle run failed")
        sys.exit(1)
    print("Oracle run complete!")


def main():
    parser = argparse.ArgumentParser(description="Run Terminal-Bench evaluation")
    parser.add_argument(
        "--agent", default="terminus",
        help="Agent type: terminus, interactive, oracle (default: terminus)",
    )
    parser.add_argument(
        "--model", default="anthropic/claude-sonnet-4-20250514",
        help="Model name (default: anthropic/claude-sonnet-4-20250514)",
    )
    parser.add_argument(
        "--dataset", default="terminal-bench-core==head",
        help="Dataset (default: terminal-bench-core==head)",
    )
    parser.add_argument(
        "--task-ids", nargs="+", default=None,
        help="Specific task IDs (default: all tasks)",
    )
    parser.add_argument(
        "--n-concurrent", type=int, default=1,
        help="Number of concurrent tasks (default: 1)",
    )
    parser.add_argument(
        "--output-dir", default="./results",
        help="Output directory (default: ./results)",
    )
    parser.add_argument(
        "--livestream", action="store_true",
        help="Show agent terminal in real-time",
    )
    parser.add_argument(
        "extra_args", nargs="*", help="Extra args passed to tb run",
    )

    args = parser.parse_args()

    if args.agent == "oracle" and args.task_ids:
        for tid in args.task_ids:
            run_oracle(tid)
    else:
        run_terminal_bench(
            agent=args.agent,
            model=args.model,
            dataset=args.dataset,
            task_ids=args.task_ids,
            n_concurrent=args.n_concurrent,
            output_dir=args.output_dir,
            livestream=args.livestream,
            extra_args=args.extra_args,
        )


if __name__ == "__main__":
    main()

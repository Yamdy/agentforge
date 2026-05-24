#!/usr/bin/env python3
"""
Custom SWE-bench inference script that works without Docker.
Directly calls LLM API to generate patches for each issue,
then saves predictions in format compatible with sb-cli.
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path

from datasets import load_dataset
from litellm import completion


SYSTEM_PROMPT = """You are an expert software engineer. You will be given a GitHub issue description
and you need to generate a git diff patch that fixes the issue.

Important rules:
1. Generate ONLY the patch in unified diff format (git diff output)
2. The patch must be minimal and focused on fixing the described issue
3. Do NOT include any explanation, only the diff
4. Start the diff with --- and +++ headers
5. Make sure the diff is valid and can be applied with git apply"""


def generate_patch(model: str, api_base: str, issue_text: str, repo: str, version: str, max_retries: int = 3) -> str:
    user_msg = f"""Repository: {repo}
Version: {version}

Issue:
{issue_text}

Generate a git diff patch to fix this issue. Output ONLY the patch, no explanation."""

    for attempt in range(max_retries):
        try:
            response = completion(
                model=model,
                api_base=api_base,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_msg},
                ],
                temperature=0.0,
                max_tokens=4096,
            )
            content = response.choices[0].message.content.strip()

            if "diff --git" in content or "--- a/" in content:
                if "```diff" in content:
                    content = content.split("```diff")[1].split("```")[0].strip()
                elif "```" in content:
                    content = content.split("```")[1].split("```")[0].strip()
                    if content.startswith("diff"):
                        pass
                    else:
                        content = ""
                return content
            elif "--- a/" in content or "+++" in content:
                return content
            else:
                if attempt < max_retries - 1:
                    continue
                return content

        except Exception as e:
            print(f"  API error (attempt {attempt+1}): {e}")
            if attempt < max_retries - 1:
                time.sleep(10 * (attempt + 1))
            else:
                return ""

    return ""


def main():
    parser = argparse.ArgumentParser(description="Custom SWE-bench inference (no Docker needed)")
    parser.add_argument("--model", default="deepseek/deepseek-chat")
    parser.add_argument("--api-base", default="https://api.deepseek.com")
    parser.add_argument("--dataset", default="verified", choices=["verified", "lite", "full"])
    parser.add_argument("--slice", default=None, help="Instance slice, e.g. ':5' for first 5")
    parser.add_argument("--output", default="./results/predictions.json")
    parser.add_argument("--max-retries", type=int, default=3)
    args = parser.parse_args()

    os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")

    dataset_map = {
        "verified": "princeton-nlp/SWE-bench_Verified",
        "lite": "princeton-nlp/SWE-bench_Lite",
        "full": "princeton-nlp/SWE-bench",
    }

    print(f"Loading dataset: {dataset_map[args.dataset]}")
    ds = load_dataset(dataset_map[args.dataset], split="test")

    if args.slice:
        start, end = 0, len(ds)
        s = args.slice.strip(":")
        if s:
            parts = s.split(":")
            if parts[0]:
                start = int(parts[0])
            if len(parts) > 1 and parts[1]:
                end = int(parts[1])
        ds = ds.select(range(start, min(end, len(ds))))

    total = len(ds)
    print(f"Running inference on {total} instances with model {args.model}")

    predictions = {}
    stats = {"total": total, "success": 0, "empty": 0, "errors": 0}

    for i, instance in enumerate(ds):
        instance_id = instance["instance_id"]
        repo = instance.get("repo", "")
        version = instance.get("version", "")
        problem = instance.get("problem_statement", "")

        print(f"\n[{i+1}/{total}] {instance_id} (repo: {repo})")

        try:
            patch = generate_patch(
                model=args.model,
                api_base=args.api_base,
                issue_text=problem,
                repo=repo,
                version=version,
                max_retries=args.max_retries,
            )

            if patch:
                predictions[instance_id] = {
                    "model_patch": patch,
                    "model_name_or_path": args.model.replace("/", "_"),
                }
                stats["success"] += 1
                print(f"  ✓ Patch generated ({len(patch)} chars)")
            else:
                predictions[instance_id] = {
                    "model_patch": "",
                    "model_name_or_path": args.model.replace("/", "_"),
                }
                stats["empty"] += 1
                print(f"  ✗ Empty patch")

        except Exception as e:
            predictions[instance_id] = {
                "model_patch": "",
                "model_name_or_path": args.model.replace("/", "_"),
            }
            stats["errors"] += 1
            print(f"  ✗ Error: {e}")

        if (i + 1) % 10 == 0:
            output_path = Path(args.output)
            output_path.parent.mkdir(parents=True, exist_ok=True)
            with open(output_path, "w") as f:
                json.dump(predictions, f, indent=2)
            print(f"\n  [Checkpoint] Saved {len(predictions)} predictions to {output_path}")

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w") as f:
        json.dump(predictions, f, indent=2)

    print(f"\n{'='*60}")
    print(f"Inference Complete!")
    print(f"  Total:    {stats['total']}")
    print(f"  Success:  {stats['success']}")
    print(f"  Empty:    {stats['empty']}")
    print(f"  Errors:   {stats['errors']}")
    print(f"  Output:   {output_path}")
    print(f"{'='*60}")

    print(f"\nTo evaluate on SWE-bench cloud:")
    print(f"  sb-cli submit swe-bench_verified test --predictions_path {output_path} --run_id my-run")


if __name__ == "__main__":
    main()

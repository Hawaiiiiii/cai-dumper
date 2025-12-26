import json
import sys
from pathlib import Path


def load_messages(jsonl_path: Path):
	messages = []
	with jsonl_path.open("r", encoding="utf-8") as f:
		for line in f:
			line = line.strip()
			if not line:
				continue
			try:
				messages.append(json.loads(line))
			except json.JSONDecodeError:
				# skip malformed lines but continue
				continue
	return messages


def summarize(messages):
	total = len(messages)
	if total == 0:
		return "# Analysis\n\nNo messages found."

	first = messages[0].get("text", "") if messages else ""
	last = messages[-1].get("text", "") if messages else ""
	users = sum(1 for m in messages if m.get("role") == "user")
	chars = sum(1 for m in messages if m.get("role") == "char")

	return (
		"# Analysis\n\n"
		f"Total messages: {total}\n\n"
		f"User messages: {users}\n"
		f"Character messages: {chars}\n\n"
		"## First message\n"
		f"{first}\n\n"
		"## Last message\n"
		f"{last}\n"
	)


def main():
	if len(sys.argv) < 2:
		print("Usage: python analyzer.py <transcript.jsonl>")
		sys.exit(1)

	jsonl_path = Path(sys.argv[1]).expanduser()
	if not jsonl_path.exists():
		print(f"File not found: {jsonl_path}")
		sys.exit(2)

	messages = load_messages(jsonl_path)
	summary = summarize(messages)

	out_dir = jsonl_path.parent
	summary_path = out_dir / "summary.md"
	summary_path.write_text(summary, encoding="utf-8")

	print(f"Wrote summary to {summary_path}")
	sys.exit(0)


if __name__ == "__main__":
	main()

### Validation and Autoreview

Validation and DarkFactory Autoreview are independent required gates. Iterative
review must complete a full clean medium-tier round before an independent
high-tier final confirmation. Any final finding returns to bounded fix and
iterative review-to-clean. Autoreview evaluates correctness and whether the
target provides adequate validation coverage. Review profiles leave exact-head
command execution evidence to the separate Validate gate; every non-review
profile retains its declared validation duties. Malformed verdicts, incomplete
findings, exhausted rounds, unavailable routes, red or missing required gates,
or actual validation-coverage gaps still block closed.

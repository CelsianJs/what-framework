# Stress and Adversarial Corpus

These files are preserved exploratory stress cases that were previously tracked
under `tmp/`. They are intentionally not wired into CI because several encode
historical or experimental expectations that do not match the current What
Framework runtime contract.

Promote a case into the normal package test suites only after it has been
reviewed, made deterministic, and updated to assert current supported behavior.
Keep generated scratch output in ignored `tmp/` instead of committing it.

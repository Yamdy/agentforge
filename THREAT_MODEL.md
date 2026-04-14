# Threat Model for AgentForge

This document outlines the primary security threats considered in AgentForge design and the mitigation strategies currently in place.

## 1. Prompt Injection

**Threat:** Attackers manipulate the LLM into ignoring original instructions and following attacker-controlled instructions. This can lead to unexpected behavior, information disclosure, or privilege escalation.

**Mitigation:**

- Built-in prompt injection detection via keywords in the security middleware
- Detection can be configured to warn or block
- Further mitigation: Use clear instruction boundaries in system prompts, follow LLM prompt engineering best practices

## 2. Path Traversal Attacks

**Threat:** Malicious tool inputs could attempt to access files outside the allowed working directory, potentially exposing sensitive system files or credentials.

**Mitigation:**

- Sandbox policy enforces allowed/denied path checking (`src/sandbox/policy.ts`)
- Default deny list includes common credential locations (`.ssh`, `.aws`, `.env` files, etc.)
- All paths are normalized and checked before any filesystem access

## 3. Sensitive Information Leakage

**Threat:** User inputs or LLM outputs may contain PII (personal identifiable information) or other sensitive data that should not be logged or persisted.

**Mitigation:**

- Security middleware provides built-in PII detection
- PII can be automatically redacted from content before logging/storage
- Configurable policies: redact or block based on requirements

## 4. Tool Abuse

**Threat:** LLMs may misuse enabled tools in unexpected ways, potentially causing unintended side effects (e.g., deleting files, installing malware).

**Mitigation:**

- Sandbox execution environment with configurable timeout and output limits
- User approval middleware (`hitl`) available for high-risk operations
- It is the agent developer's responsibility to enable only necessary tools and configure appropriate policies

## 5. Supply Chain Attacks

**Threat:** Third-party plugins or dependencies could contain malicious code.

**Mitigation:**

- No current mitigation beyond standard dependency review
- Users should vet third-party plugins before use

## Reporting Security Issues

If you discover a security vulnerability, please report it via GitHub Issues.

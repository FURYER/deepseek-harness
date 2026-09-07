---
description: "Host audio notifications for agent turn completions, user questions, and approvals."
kind: "package-reference"
---

# @deepseek-ai/dsh-sound-notifications

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-sound-notifications` provides asynchronous host OS audio notifications when an agent finishes its turn, asks the user a question via `ask_user_question`, or requests a sensitive action approval.

## Use this package

Mount this plugin to receive system audio cues when human attention is requested or when a long-running turn completes.

### Configuration

```yaml
- id: sound-notifications
  name: '@deepseek-ai/dsh-sound-notifications'
  config:
    enabled: true
    onTurnComplete: true
    onQuestion: true
    onApproval: true
    turnCompleteSound: Asterisk
    questionSound: Exclamation
```

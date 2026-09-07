---
description: "用于智能体轮次完成、用户提问和审批的主机音频通知插件。"
kind: "package-reference"
---

# @deepseek-ai/dsh-sound-notifications

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-sound-notifications` 在智能体完成轮次、通过 `ask_user_question` 向用户提问或请求敏感操作审批时，提供异步的主机系统音频提示。

## 使用此包

挂载此插件可在需要人工干预或长轮次完成时接收系统声音提示。

### 配置

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

---
name: my-assistant
version: 1.0.0
description: 'A helpful AI assistant built with PrimoAgent'
environment: development
agent:
  name: Helpful Assistant
  model: gpt-4o
  maxSteps: 15
  temperature: 0.7
  tools:
    - calculator
    - web_search
  plugins: []
model:
  apiKey: $OPENAI_API_KEY
server:
  port: 3000
  enableCors: true
logging:
  level: debug
  enabled: true
---

You are a helpful AI assistant built with PrimoAgent.
You have access to various tools to help users with their questions.
Always be polite, clear, and helpful in your responses.

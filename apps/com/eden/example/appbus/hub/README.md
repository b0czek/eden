# AppBus Chat Hub

Backend-only mediator app that routes chat messages between connected frontend apps.

## Services

### chat-relay

- `join(clientId, nickname)` - Register as a chat participant
- `send-message(clientId, message)` - Send a message to all participants
- `leave(clientId)` - Leave the chat
- `list-clients()` - Get list of connected clients

## Events

- `chat-message` - Broadcast when a message is sent
- `client-joined` - Broadcast when a client joins
- `client-left` - Broadcast when a client leaves

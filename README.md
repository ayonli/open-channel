# Open-Channel

**A self-hosting inter-process communication channel for NodeJS.**

## Design Purpose

Even if NodeJS provides its IPC communication abilities internally and there are
a lot third party packages that provides IPC functionality. However, all of them
require starting an IPC server or based on **cluster**/**child_process**, which 
are very unsuitable and may not work with the some situations:

1. The developer doesn't have authority to write any logic in the master process, 
    e.g. your app runs under [PM2](https://pm2.io) supervision.
2. If the IPC server is down, all communications will be lost and must manually 
    restart the server.
3. The developer must set exact protocol and net port (probably) to communicate,
    which may not be available when run-time environment is changed.

**Open-Channel is meant to resolve these problems.** With it, you will have
these advantages:

1. No need of master process accessibility, all code is written for a single 
    process (whether it will be run as child-process or individual process).
2. No need to start the IPC server manually, the channel will ship it internally.
3. Automatically switch the best protocol to transmit, on Unit, it uses domain
    socket, on Windows, it uses named pipe by default and changed to net port 
    when in cluster mode.
4. Automatically reconnect and resend messages if the connection is lost, always
    keep communications ongoing.
5. Sending messages even before the connection established, they will be queued
    and sent once connection is ready.

## Example

```javascript
const openChannel = require("open-channel").default;

var channel = openChannel(socket => {
    // This is a connection lister that passed to net.createServer().
    // The server instance will not be created until the first time calling 
    // channel.connect().
    // Put Your logic here to handle client connections and communications with 
    // the server.
});

// Gets a net.Socket instance connected to the server.
// you can pass an optional timeout argument in milliseconds to connect().
// The connection will not be immediately ready, but you still can send messages.
var socket = channel.connect();

// Put you logic here to communicate with the server.
```

## API

- `openChannel(connectionListener: (socket: net.Socket) => void): ProcessChannel`
- `openChannel(name: string, connectionListener: (socket: net.Socket) => void): ProcessChannel`
    - `name` The name of the channel. It's required to set a unique name of the 
        channel when you have multiple channels on the same machine.
    - `connectionListener` is set for `net.createServer()`.

- `channel.connect(timeout?: number): net.Socket` Gets the socket client that 
    will connect to the internal server.
    - `timeout` Default value is `5000`ms.

- `channel.name: string` The same name passed to `openChannel()`.

- `channel.state: string` Returns the status of the channel, which will either 
    be `initiated`, `connecting`, `connected` or `closed`.

- `channel.connected: boolean` Whether the channel is connected to the internal 
    server.

- `socket.write()` The client side write method has been re-written to implement
    sending messages even when the channel state is connecting.

- `socket.destroy()` The client side destroy method has been re-written to 
    implement closing both the channel and the socket. (The internal server will
    still be working, and currently unable to close the channel on server side.)
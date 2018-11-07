# IPChannel

**Serve an inter-process channel in the process itself.**

*Note: this is just a framework without any communication logic. it exposes a* 
*channel API that you can build logic upon it,*

## Design Purpose

Even if NodeJS provides its IPC communication abilities internally and there are
a lot third party packages that provides IPC functionality. However, all of them
require starting a IPC server or based on **cluster**/**child-process**, which 
are very unsuitable and not work with the following situations:

1. The developer doesn't have authority to write and logic in the master process, 
    e.g. your app runs under [PM2](https://pm2.io) supervision.
2. If the IPC server is down, all communications will be lost and must manually 
    restart the server.

**IPChannel is meant to resolve these problems.** With IPChannel, you will have
these advantages:

1. No need of master process accessibility, all code is written for a single 
    process (whether is will be run as child-process or individual process).
2. If the IPC server is down, the program will automatically reship a new one 
    and keep communications continue.

## Example

```javascript
const { openChannel } = require("ipchannel");

var channel = openChannel(socket => {
    // This is a connection lister that passed to net.createServer().
    // The server instance will not be created until the first time calling 
    // channel.connect().
    // Put Your logic here to handle client connections and communications with 
    // the server.
});

(async () => {
    // Gets a net.Socket instance connected to the server.
    // you can pass an optional timeout argument in milliseconds to connect().
    var socket = await channel.connect();
    
    // Put you logic here to communicate with the server.
})();
```

## Warning

During re-connection time period, there might be a down time before connection 
reestablished, so it's much safer every time sending a message, check if the 
connection is available (not `destroyed`). Or you can disable the default 
re-connection operation and write your own.

```javascript
const { openChannel } = require("ipchannel");

// disable default re-connection functionality
var channel = openChannel(/* ... */);
channel.autoReconnect = false;

(async () => {
    var socket = await channel.connect();
    
    socket.on("error", async (err) => {
        if (isSocketResetError(err)) {
            merge(socket, channel.connect());
        }
    });
})();
```

Be aware, a re-connection operation happens when the connection is reset, often
means that server is down, when re-connecting, the program will automatically 
check if it should reship the server. You don't need to concern what and how the
program does these thing, just focus on your own communication logic.
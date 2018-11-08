"use strict";

const { openChannel } = require(".");
const cluster = require("cluster");

var channel = openChannel(socket => {
    let msg = [];

    socket.on("data", buf => {
        // msg.push(buf.toString());
        console.log(buf.toString())

        socket.destroyed || socket.write(String(process.pid))
    });
});

// if (cluster.isMaster) {
//     var workers = [];

//     for (let i = 0; i < 4; i++) {
//         let worker = cluster.fork();
//     }
// } else {
(async () => {
    var socket = await channel.connect();
    var send = (data) => new Promise(resolve => socket.write(data, resolve));

    setInterval(() => {
        socket.destroyed || socket.write(String(process.pid))
    }, 1000);

    socket.on("data", buf => {
        console.log(buf.toString());
    });
})();
// }
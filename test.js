"use strict";

const cluster = require("cluster");
const assert = require("assert");
const net = require("net");
const { encode, decode } = require("encoded-buffer");

if (cluster.isMaster) {
    var errors = [];

    for (let i = 0; i < 4; i++) {
        let worker = cluster.fork();

        worker.on("message", (msg) => {
            try { msg = decode(Buffer.from(msg))[0] } finally { }
            if (msg instanceof Error) {
                console.log(msg);
                worker.kill();
                errors.push(msg);
            }
        });
    }

    setTimeout(() => {
        if (errors.length) {
            process.exit(1);
        } else {
            process.exit();
        }
    }, 2000);
} else {
    const { openChannel } = require(".");
    var channel;

    describe("open channel", () => {
        channel = openChannel(socket => {
            socket.on("data", buf => {
                try {
                    assert.strictEqual(buf.toString(), "Hello, World!");
                    socket.write("Hi, World!");
                } catch (err) {
                    sendError(err);
                }
            });
        });

        it("should open the channel as expected", () => {
            assert.strictEqual(channel.connected, false);
        });
    });

    function sendError(err) {
        return process.send(encode(err).toString());
    }

    describe("connect to the channel", () => {
        var socket = channel.connect();

        it("should return a net.Socket instance from channel.connect()", () => {
            assert.ok(socket instanceof net.Socket);
        });

        it("should establish connection as expected", (done) => {
            let test = () => {
                if (channel.connected) {
                    clearInterval(timer);
                    try {
                        assert.strictEqual(channel.state, "connected");
                        assert.strictEqual(channel.connected, true);
                        assert.strictEqual(socket.connecting, false);
                        assert.strictEqual(socket.destroyed, false);
                        done();
                    } catch (err) {
                        done(err);
                    }
                }
            };
            let timer = setInterval(test, 4);
            test();
        });

        it("should send message as expected", (done) => {
            socket.write("Hello, World!", () => {
                done();
            });
        });

        it("should receive messages as expected", (done) => {
            socket.on("data", buf => {
                try {
                    assert.strictEqual(buf.toString(), "Hi, World!");
                    done();
                } catch (err) {
                    done(err);
                }
            });
        });

        it("should close the channel as expected", (done) => {
            try {
                socket.destroy();
                assert.strictEqual(socket.destroyed, true);
                assert.strictEqual(channel.state, "closed");
                assert.strictEqual(channel.connected, false);
                done();
            } catch (err) {
                sendError(err);
                done(err);
            }
        });
    });
}
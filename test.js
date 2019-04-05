"use strict";

const cluster = require("cluster");
const assert = require("assert");
const net = require("net");
const { encode, decode } = require("encoded-buffer");

if (cluster.isMaster) {
    var errors = [];

    for (let i = 0; i < 2; i++) {
        let worker = cluster.fork();

        worker.on("message", (msg) => {
            try {
                msg = decode(Buffer.from(msg))[0];
            } finally {
                if (msg instanceof Error) {
                    console.log(msg);
                    worker.kill();
                    errors.push(msg);
                }
            }
        });
    }

    setTimeout(() => {
        if (errors.length) {
            process.exit(1);
        } else {
            process.exit();
        }
    }, 3000);
} else {
    const { openChannel, ProcessChannel } = require(".");
    /** @type {ProcessChannel} */
    var channel;

    let sendError = function (err) {
        return process.send(encode(err).toString());
    };

    describe("open channel", () => {
        var listener = socket => {
            socket.on("data", buf => {
                try {
                    assert.strictEqual(buf.toString(), "Hello, World!");
                    socket.write("Hi, World!");
                } catch (err) {
                    sendError(err);
                }
            });
        };
        channel = openChannel(listener);

        it("should open the default channel as expected", (done) => {
            try {
                assert.ok(channel instanceof ProcessChannel);
                assert.strictEqual(channel.name, "open-channel");
                assert.strictEqual(channel.connected, false);
                assert.strictEqual(channel.connectionListener, listener);
                done();
            } catch (err) {
                sendError(err);
                done(err);
            }
        });

        it("should open a channel with a custom name as expected", (done) => {
            try {
                var listener = () => { };
                var channel1 = openChannel("my-channel", listener);
                assert.strictEqual(channel1.name, "my-channel");
                assert.strictEqual(channel1.connectionListener, listener);
                done();
            } catch (err) {
                sendError(err);
                done(err);
            }
        });
    });

    describe("connect to the channel", () => {
        var socket = channel.connect();

        it("should return a net.Socket instance from channel.connect()", (done) => {
            try {
                assert.ok(socket instanceof net.Socket);
                done();
            } catch (err) {
                sendError(err);
                done(err);
            }
        });

        it("should establish connection as expected", (done) => {
            let retries = 0;
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
                        sendError(err);
                        done(err);
                    }
                } else if (retries == 20) {
                    let err = new Error(`cannot connect the channel: ${channel.name}`);
                    sendError(err);
                    done(err);
                } else {
                    retries++;
                }
            };
            let timer = setInterval(test, 50);
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
                    sendError(err);
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
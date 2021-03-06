# FastMQ
> High performance message broker for node.js with multiple network transports support.

**Table of Contents**
* [Overview](#overview)
* [Features](#features)
* [Installation](#installation)
* [Examples](#examples)
    * [Simple REQUEST/RESPONSE server and client](#simple-requestresponse-server-and-client)
    * [Simple REQUEST/RESPONSE pattern between two clients](#simple-requestresponse-pattern-between-two-clients)
    * [Simple PUSH/PULL pattern, one PUSH, two PULL workers](#simple-pushpull-pattern-one-push-two-pull-workers)
    * [Simple PUBLISH/SUBSCRIBE pattern, one PUBLISH, two SUBSCRIBE channels](#simple-publishsubscribe-pattern-one-publish-two-subscribe-channels)
* [API](#api)
    * [FastMQ.Server.create(name)](#fastmqservercreatename)
    * [FastMQ.Server.create(name, port[, host])](#fastmqservercreatename-port-host)
    * [Class: FastMQ.Server](#class-fastmqserver)
        * [server.start()](#serverstart)
        * [server.stop()](#serverstop)
        * [server.request(target, topic, data = {}, contentType = 'json')](#serverrequesttarget-topic-data---contenttype--json)
        * [server.response(topic, listener)](#serverresponsetopic-listener)
    * [FastMQ.Client.connect(channelName, serverChannel[, connectListener])](#fastmqclientconnectchannelname-serverchannel-connectlistener)
    * [FastMQ.Client.connect(channelName, serverChannel, port[, host][, connectListener])](#fastmqclientconnectchannelname-serverchannel-port-host-connectlistener)
    * [Class: FastMQ.Channel](#class-fastmqchannel)
        * [channel.disconnect()](#channeldisconnect)
        * [channel.onError(listener)](#channelonerrorlistener)
        * [channel.request(target, topic, data = {}, contentType = 'json')](#channelrequesttarget-topic-data---contenttype--json)
        * [channel.response(topic, listener)](#channelresponsetopic-listener)
        * [channel.push(target, topic, items, contentType = 'json')](#channelpushtarget-topic-items-contenttype--json)
        * [channel.pull(topic, options, listener)](#channelpulltopic-options-listener)
        * [channel.publish(target, topic, data, contentType = 'json')](#channelpublishtarget-topic-data-contenttype--json)
        * [channel.subscribe(topic, listener)](#channelsubscribetopic-listener)
    * [Class: FastMQ.Message](#class-fastmqmessage)
        * [message.header](#messageheader)
        * [message.payload](#messagepayload)
    * [Class: FastMQ.Response](#class-fastmqresponse)
        * [response.setError(errCode)](#responseseterrorerrcode)
        * [response.send(data, contentType)](#responsesenddata-contenttype)

## Overview
FastMQ is a node.js based message broker aims to let programmer easy to commuicate between different processes or machines.
It is designed for high performance which can achieve to over 30000 message delivery per second with 64KB message payload, and with small size header overhead.

It support both local socket(Unix domain socket and Windows pipe) for local process communication, and also supports reliable TCP connections between machines.

Which makes FastMQ suitable as backend service for IPC, clusters, and micro service applications.


## Features
* Pure javascript and asynchronous message broker, compatiable with node.js >= 4.x
* Easy to communicate between proceeses and machines
* All major functions support Promise for better async. programming
* Small extra size overhead with packed binary header
* Support various of payload formats: JSON, Raw Binary and Plain Text
* Support **REQUEST/RESPONSE** pattern for executing asynchronous Remote Procedure Call (RPC)
* Support **PUSH/PULL** pattern for distributing large number of tasks among workers
* Support **PUBLISH/SUBSCRIBE** pattern for sending messages to many consumers at once
* Support Unix domain socket / Windows pipe and TCP socket
* GLOB topic expression to specify message routing

## Installation
Install FastMQ via npm or yarn
```shell
npm install fastmq
```
```shell
yarn add fastmq
```

## Examples

### Simple REQUEST/RESPONSE server and client

Server.js: Simple server handle 'test_cmd' topic request
```javascript
const FastMQ = require('fastmq');

// Create message broker server with 'master' channel name
const server = FastMQ.Server.create('master');

// Register topic: 'test_cmd', receive message and response back to client requester
server.response('test_cmd', (msg, res) => {
    console.log('Server receive request payload:', msg.payload);
    // echo request data back;
    let resData = {data: msg.payload.data};
    res.send(resData, 'json');
});

// start server
server.start().then(() => {
    console.log('Message Broker server started');
});
```

Simple client send 'test_cmd' topic to server('master' channel)
```javascript
const FastMQ = require('fastmq');

var requestChannel;
// create a client with 'requestChannel' channel name and connect to server.
FastMQ.Client.connect('requestChannel', 'master')
.then((channel) => {
    // client connected
    requestChannel = channel;

    // send request to 'master' channel  with topic 'test_cmd' and JSON format payload.
    let reqPayload = {data: 'reqeust data'};
    return requestChannel.request('master', 'test_cmd', reqPayload, 'json');
})
.then((result) => {
    console.log('Got response from master, data:' + result.payload.data);
    // client channel disconnect
    requestChannel.disconnect();
})
.catch((err) => {
    console.log('Got error:', err.stack);
});
```


### Simple REQUEST/RESPONSE pattern between two clients

Client1.js: Connect to server, register 'responseChannel' channel, and handle 'test_cmd' topic
```javascript
const FastMQ = require('fastmq');

var responseChannel;
// create a client with 'requestChannel' channel name and connect to server.
FastMQ.Client.connect('responseChannel', 'master')
.then((channel) => {
    // client connected
    responseChannel = channel;
    responseChannel.response('test_cmd', (msg, res) => {
        console.log('Receive request payload:', msg.payload);
        // echo request data back;
        let resData = {data: msg.payload.data};
        res.send(resData, 'json');
    });

})
.catch((err) => {
    console.log('Got error:', err.stack);
});
```

Client2.js: Connect to server, register 'requestChannel' channel, and send 'test_cmd' request
```javascript
const FastMQ = require('fastmq');

var requestChannel;
// create a client with 'requestChannel' channel name and connect to server.
FastMQ.Client.connect('requestChannel', 'master')
.then((channel) => {
    // client connected
    requestChannel = channel;
    let reqPayload = {data: 'reqeust data'};

    // send request to 'responseChannel' channel  with topic 'test_cmd' and JSON format payload.
    return requestChannel.request('responseChannel', 'test_cmd', reqPayload, 'json');
})
.then((result) => {
    console.log('Got response from master, data:' + result.payload.data);
    // client channel disconnect
    requestChannel.disconnect();
})
.catch((err) => {
    console.log('Got error:', err.stack);
});
```


### Simple PUSH/PULL pattern, one PUSH, two PULL workers

push_client.js: Push 'add_job' message to all channels match 'worker*' GLOB expression
```javascript
const FastMQ = require('fastmq');

var pushChannel;
// create a client with 'pushChannel' channel name and connect to server.
FastMQ.Client.connect('pushChannel', 'master')
.then((channel) => {
    pushChannel = channel;

    // generate 10 tasks
    var data = [];
    for (let i = 1; i <= 10; i++)
        data.push({id: 'job' + i});

    // push tasks to 'worker*' channels
    return pushChannel.push('worker*', 'add_job', data);
})
.then(() => {
    console.log('Push 10 tasks to worker*:add_job');
    pushChannel.disconnect();
})
.catch((err) => {
    console.log('Got error:', err.stack);
});
```

worker1.js: Pull 'add_job'
```javascript
const FastMQ = require('fastmq');

var workerChannel;
// create a client with 'worker1' channel name and connect to server.
FastMQ.Client.connect('worker1', 'master')
.then((channel) => {
    workerChannel = channel;

    // handle 'add_job' push message
    workerChannel.pull('add_job', (msg) => {
        console.log('Worker1 receive job:', msg.payload.id);
    });
})
.catch((err) => {
    console.log('Got error:', err.stack);
});
```

worker2.js: Pull 'add_job'
```javascript
const FastMQ = require('fastmq');

var workerChannel;
// create a client with 'worker2' channel name and connect to server.
FastMQ.Client.connect('worker2', 'master')
.then((channel) => {
    workerChannel = channel;

    // handle 'add_job' push message
    workerChannel.pull('add_job', (msg) => {
        console.log('Worker2 receive job:', msg.payload.id);
    });
})
.catch((err) => {
    console.log('Got error:', err.stack);
});
```


### Simple PUBLISH/SUBSCRIBE pattern, one PUBLISH, two SUBSCRIBE channels
publish.js: Publish 'log' message to to all channels match 'console.*' GLOB expression
```javascript
const FastMQ = require('fastmq');

var pubChannel;
FastMQ.Client.connect('publisher', 'master')
.then((channel) => {
    pubChannel = channel;
    return pubChannel.publish('console.*', 'log', {data: 'a example log'}, 'json');
})
.then(() => {
    console.log('Push log to console.*');
    pubChannel.disconnect();
})
.catch((err) => {
    console.log('Got error:', err.stack);
});
```

console1.js: 'console.1' channel, subscribe 'log' topic
```javascript
const FastMQ = require('fastmq');

var subChannel;
FastMQ.Client.connect('console.1', 'master')
.then((channel) => {
    subChannel = channel;

    // subscribe 'log' topic
    subChannel.subscribe('log', (msg) => {
        console.log('Console.1 receive log:', msg.payload.data);
    });
})
.catch((err) => {
    console.log('Got error:', err.stack);
});
```

console2.js: 'console.2' channel, subscribe 'log' topic
```javascript
const FastMQ = require('fastmq');

var subChannel;
FastMQ.Client.connect('console.2', 'master')
.then((channel) => {
    subChannel = channel;

    // subscribe 'log' topic
    subChannel.subscribe('log', (msg) => {
        console.log('Console.2 receive log:', msg.payload.data);
    });
})
.catch((err) => {
    console.log('Got error:', err.stack);
});
```


# API
FastMQ contains serveral major classes:

1. FastMQ.Server: Message broker server.
2. FastMQ.Client: Message broker client.
3. FastMQ.Channel: Message broker client channel which created by FastMQ.Client.connect.
4. FastMQ.Message: Generic message class which contains message header and payload.
5. FastMQ.Response: The response helper in response listener to send response payload


## FastMQ.Server.create(name)
* `name`: <String> - the channel name of server.

A factory function, create local socket message broker server. It create a UNIX domain socket or Windows named PIPE to accept local communication between proccesses.

Return Value: `FastMQ.Server` object


## FastMQ.Server.create(name, port[, host])
* `name`: &lt;String> - the channel name of server.
* `port`: &lt;Number> - listen port of this server.
* `host`: &lt;String> - listen hostname of this server, defaults to 'localhost'.

A factory function, reate TCP socket message broker server. It's useful to communication between different machines.

Return Value: `FastMQ.Server` object



## Class: FastMQ.Server
A local or TCP message broker server.


### server.start()
Start server. It is an async. operation which return a &lt;Promise> and resolve when server has been started.

Return Value: A &lt;Promise> that is resolved with &lt;FastMQ.Server> object.


### server.stop()
Stop server. It is an async. operation which return a &lt;Promise> and resolve when server has been  stopped.

Return Value: A &lt;Promise> that is resolved with &lt;FastMQ.Server> object.


### server.request(target, topic, payload = {}, contentType = 'json')
* `target`: &lt;String> -  target channel name to send request, support GLOB expression, ex: 'log.*.debug'.
* `topic`: &lt;String> - topic name of this request.
* `payload`: &lt;Object>|&lt;Buffer>|&lt;String> - payload of this request, the type of this parameter depends on `contentType` parameter.
* `contentType`: &lt;String> - content type of `payload`. Valid values: 'json', 'raw', 'string'.

Send a REQUEST message to the `target` channel which listen `topic`, and return a &lt;Promise> which resolved with a RESPONSE message.

Due to the one-2-one behavior of REQUEST/RESPONSE, message broker will choose only one channel automatically if multiple channels matches `target`.

For example, there are two channels 'worker.1' and 'worker.2' listen a topic 'doSomething', and a channel sends a request to `target` 'worker.*' with 'doSomething' `topic`. The message broker will choose one channel of 'worker.1' and 'worker.2' to send/receive message.

If you want to send message from one channel to multiple channels, you might perfer to use PUSH/PULL or PUBLISH/SUBSCRIBE pattern.

Return Value: A &lt;Promise> that is resolved with &lt;FastMQ.Message> object.


### server.response(topic, listener)
* `topic`: &lt;String> - topic name to listen.
* `listener`: &lt;Function> - The callback to handle request message.

Listen `topic` to receive REQUEST message and send response.

The `listener` is passed with two parameters `(req, res)`, where `req` is a &lt;FastMQ.Message> object contains request message, and `res` is a &lt;FastMQ.Response> object to send response back to request channel.

This method returns current server object, which can be used as Method Chaining syntax, for example:

```javascript
server.response('topic1', listener1).response('topic2', listener2);
```

Return Value: An &lt;FastMQ.Server> object.


---
## FastMQ.Client.connect(channelName, serverChannel[, connectListener])
* `channelName`: &lt;String> - the channel name created by this method.
* `serverChannel`: &lt;String> - server channel name.
* `connectListener`: &lt;Function>, Optional - listener when connect to server.

A factory function, returns a new `FastMQ.Channel` object and connect to the local socket message broker server.

The `listener` is passed with two parameters `(err, channel)`, where `err` is a &lt;Error> object when connect fail or `null` when connect success, and `channel` is a &lt;FastMQ.Channel> object.

It supports two different styles, node.js callback style when specify `connectListener` or Promise style which returns a Promise object that is resolved with new &lt;FastMQ.Channel> object when connect success or rejected if not.

Return Value: A &lt;Promise> that is resolved with new &lt;FastMQ.Channel> object when connected success or rejected if not.



## FastMQ.Client.connect(channelName, serverChannel, port[, host][, connectListener])
* `channelName`:&lt;String> - the channel name created by this method.
* `serverChannel`:&lt;String> - server channel name.
* `port`:&lt;Number> - server listening port.
* `host`:&lt;String>, Optional - server host name, defaults to 'localhost'.
* `connectListener`: &lt;Function>, Optional - The callback when connect to server.

A factory function, returns a new `FastMQ.Channel` object and connect to the TCP socket message broker server.

It supports two different styles same as `FastMQ.Client.connect(channelName, serverChannel[, connectListener])`.

Return Value: A &lt;Promise> that is resolved with new &lt;FastMQ.Channel> object when connected success or rejected if not.


## Class: FastMQ.Channel
Message channel created by FastMQ.Client.connect method.

### channel.onError(listener)
`listener`:  &lt;Function> - The callback to handle error.

Add the `listener` to handle error.

The `listener` callback function is passed with one parameter `(err)`, where `err` is a &lt;Error> object.



### channel.disconnect()
Disconnect channel.

### channel.request(target, topic, data = {}, contentType = 'json')
* `target`: &lt;String> -  target channel name to send request, support GLOB expression, ex: 'log.*.debug'.
* `topic`: &lt;String> - topic name of this request.
* `payload`: &lt;Object>|&lt;Buffer>|&lt;String> - payload of this request, the type of this parameter depends on `contentType` parameter.
* `contentType`: &lt;String> - content type of `payload`. Valid values: 'json', 'raw', 'string'.

Send a REQUEST message to the `target` channel which listen `topic`, and return a &lt;Promise> which resolved with  RESPONSE message.

Due to the one-to-one behavior of REQUEST/RESPONSE, message broker will choose only one channel automatically if multiple channels matches `target`.

For example, there are two channels 'worker.1' and 'worker.2' listen a topic 'doSomething', and a channel sends a request to `target` 'worker.*' with 'doSomething' `topic`. The message broker will choose one channel of 'worker.1' and 'worker.2' to send/receive message.

If you want to send message from one channel to multiple channels, you might perfer to use PUSH/PULL or PUBLISH/SUBSCRIBE pattern.

Return Value: A &lt;Promise> that is resolved with &lt;FastMQ.Message> object.



### channel.response(topic, listener)
* `topic`: &lt;String> - topic name to listen.
* `listener`: &lt;Function> - The callback to handle request message.

Listen `topic` to receive REQUEST message and send response.

The `listener` is passed with two parameters `(req, res)`, where `req` is a &lt;FastMQ.Message> object contains request message, and `res` is a &lt;FastMQ.Response> object to send response back to request channel.

This method returns current channel object, which can be used as Method Chaining syntax, for example:

```javascript
channel.response('topic1', listener1).response('topic2', listener2);
```

Return Value: An &lt;FastMQ.Channel> object.



### channel.push(target, topic, items, contentType = 'json')
* `target`: &lt;String> -  target channel name to send request, support GLOB expression.
* `topic`: &lt;String> - topic name of this request.
* `items`: &lt;Array> - the array of payloads.
* `contentType`: &lt;String> - content type of `items` payloads. Valid values: 'json', 'raw', 'string'.

Send PUSH message to the `target` channel which listen `topic`. A PUSH message can contain multiple items, which packs in `items` parameters.

The `items` is an &lt;Array> contains multiple payloads, for example:
```javascript
// three 'json' payloads
const items = [{data: 'item1'}, {data: 'item2'}, {data: 'item3'}]
```

PUSH/PULL is a many-to-one pattern, multiple PUSH endpoints push to one queue, and multiple PULL endpoints pull payload from this queue.

Return Value: A &lt;Promise> that is resolved when this channel pushed message to message broker.



### channel.pull(topic, options, listener)
* `topic`: &lt;String> - topic name to listen.
* `options`: &lt;Object> - options
* `listener`: &lt;Function> - The callback to handle push message.

Receive PUSH message which matches the `topic` with `listener` callback, it will be invoked to receive one PUSH item, and continue to receive PUSH items until consumed completely.

Every time after the `listener` be invoked, it will send an Acknowledge message back to broker, and the broker will send further PUSH items. When any PULL channel crash/close without sending acknowledge message back, broker will re-deliver the item again.

The `listener` is passed with one parameters `(msg)`, where `msg` is a &lt;FastMQ.Message> contains one PUSH item in `msg.payload`.

The `options` is an object with the following defaults:

```javascript
{
    prefetch: 1
}
```

The `prefetch` is a &lt;Number> to tell message broker that how many PUSH items can be received by this channel without acknowledge. The higher value of `prefetch` might help to reduce round-trip costs between PULL and PUSH channels, but might causes load unbalance when multiple PULL channels listen on the same `topic`.

This method returns current channel object, which can be used as Method Chaining syntax.

Return Value: An &lt;FastMQ.Channel> object.


### channel.publish(target, topic, payload, contentType = 'json')
* `target`: &lt;String> -  target channel name to send request, support GLOB expression.
* `topic`: &lt;String> - topic name of this request.
* `payload`: &lt;Object>|&lt;Buffer>|&lt;String> - payload of this publish message, the type of this parameter depends on `contentType` parameter.
* `contentType`: &lt;String> - content type of `items` payloads. Valid values: 'json', 'raw', 'string'.

Send PUSH message to the `target` channel which listen `topic`. All SUBSCRIBE channels listening on the `topic` and match `target` will receive the same message.

Unlike PUSH/PULL, PUBLISH/SUBSCRIBE is a one-to-many pattern, and it doesn't have acknowledge mechanism because it's not make sence to re-deliver a publish message to a subscribe channel when this channel didn't listen at the time of publish message delivered.

Return Value: A &lt;Promise> that is resolved when this channel published message to message broker.



#### channel.subscribe(topic, listener)
* `topic`: &lt;String> - topic name to listen.
* `listener`: &lt;Function> - The callback to handle publish message.

Receive PUBLISH message which matches the `topic` with `listener` callback.

The `listener` is passed with one parameters `(msg)`, where `msg` is a &lt;FastMQ.Message> contains a PUBLISH message.

Return Value: A &lt;Promise> that is resolved when this channel published message to message broker.

This method returns current channel object, which can be used as Method Chaining syntax.

Return Value: An &lt;FastMQ.Channel> object.

---
## Class: FastMQ.Message
An abstract class presents variety of messages like REQUEST/RESPONSE/PUSH/PULL/PUBLISH/SUBSCRIBE message.

### message.header
An &lt;Object> contains information of message, the common parameters are listed in the following.
* id: &lt;Number> - unique message id.
* type: &lt;string> - the type of message, possible values: 'req', 'res', 'push', 'pull', 'pub', 'sub'.
* contentType: &lt;string> - the type of payload, possible values: 'json', 'raw', 'string'.
* source: &lt;string> - the source channel of message, only avails on request/response message.
* target: &lt;string> - the target channel of message, avails on all messages except ack. message.


### message.payload
The message payload, the possible types are &lt;Object>|&lt;Buffer>|&lt;String>, and the type of payload depends on `message.header.contentType`.

---
## Class: FastMQ.Response
The helper class to send response message back.

### response.send(payload, contentType)
* `payload`: &lt;Object>|&lt;Buffer>|&lt;String> - response payload, the type of this parameter depends on `contentType` parameter.
* `contentType`: &lt;String> - content type of `payload`. Valid values: 'json', 'raw', 'string'.

'use strict';
const Int64 = require('node-int64');
const generateUuid = require('./common.js').uuid;
const ErrorCode = require('./ErrorCode.js');

const MSG_TYPE = {
    req:  1,
    res:  2,
    push: 3,
    pull: 4,
    pub:  5,
    sub:  6,
    ack:  7
};
const MSG_CONTENT_TYPE = {'raw': 1, 'json': 2, 'str': 3};

/*
Message {
    length:      uint32, 4 bytes, Total length of message, includes Header
    headerLength: uint32, 4 bytes, length of header
    header:       <Header Object>, <headerLength> bytes
    payload:      payload message, <length - headerLength> bytes, the format of body depends on header.contentTtype
}
MessageType {
    req: 1,
    res: 2,
    push: 3,
    pub: 4,
    sub: 5,
    ack: 6
}

ContentType {
    raw: 1,
    json: 2,
    string: 3
}

RequestHeader & ResponseHeader {
    id:          uint64, unique message id
    type:        uint8, message type, valid value: <MessageType>
    contentType: uint8, Number, valid value: <ContentType>
    error:       uint8, Number, error code, only used in response header
    topicLen:    uint8, topic length
    topic:       <topicLen> bytes, string, message topic
    sourceLen:   uint8, source length
    source:      <sourceLen> bytes, string, source channel's name
    targetLen:   uint8, source length
    target:      <targetLen> bytes, string, target channel's name
}

PublishHeader {
    id:          uint64, unique message id
    type:        uint8, message type, valid value: <MessageType>
    contentType: uint8, Number, valid value: <ContentType>
    topicLen:    uint8, topic length
    topic:       <topicLen> bytes, string, message topic
    targetLen:   uint8, source length
    target:      <targetLen> bytes, string, target channel's name
}

SubscribeHeader {
    id:          uint64, unique message id
    type:        uint8, message type, valid value: <MessageType>
    contentType: uint8, Number, valid value: <ContentType>
    topicLen:    uint8, topic length
    topic:       <topicLen> bytes, string, message topic
}

PushHeader {
    id:          uint64, unique message id
    type:        uint8, message type, valid value: <MessageType>
    contentType: uint8, Number, valid value: <ContentType>
    topicLen:    uint8, topic length
    topic:       <topicLen> bytes, string, message topic
    targetLen:   uint8, source length
    target:      <targetLen> bytes, string, target channel's name
    itemCount:   uint32, number of items in payload
}

PullHeader {
    id:          uint64, unique message id
    type:        uint8, message type, valid value: <MessageType>
    contentType: uint8, Number, valid value: <ContentType>
    topicLen:    uint8, topic length
    topic:       <topicLen> bytes, string, message topic
}

AckHeader {
    id:          uint64, message id of PullHeader.id
    type:        uint8, message type, valid value: <MessageType>
    topicLen:    uint8, topic length
    topic:       <topicLen> bytes, string, message topic
}

PushPayloadItem {
    length: uint32, item length
    item: binary, depends PushHeader.contentType
}
*/
class BufferStream
{
    constructor(a1)
    {
        if (typeof a1 === 'number')
            this._buf = Buffer.allocUnsafe(a1);
        else if (Buffer.isBuffer(a1))
            this._buf = a1;
        else
            throw TypeError('BufferStream only accept number or Buffer type as argument');
        this._offset = 0;
        this._size = a1.length;
    }
    get()
    {
        return this._buf;
    }

    get offset() {return this._offset;}
    set offset(val) {this._offset = val;}

    readUInt8()
    {
        const val = this._buf.readUInt8(this._offset);
        this._offset += 1;
        return val;
    }

    readUInt16BE()
    {
        const val = this._buf.readUInt16BE(this._offset);
        this._offset += 2;
        return val;

    }

    readUInt32BE()
    {
        const val = this._buf.readUInt32BE(this._offset);
        this._offset += 4;
        return val;

    }

    readUInt64BE()
    {
        const val = new Int64(this._buf, this._offset).toNumber();
        this._offset += 8;
        return val;
    }

    readString(length, encoding = 'utf8')
    {
        const val = this._buf.toString(encoding, this._offset, this._offset + length);
        this._offset += length;
        return val;
    }

    readBuffer(length)
    {
        const val = this._buf.slice(this._offset, this._offset + length);
        this._offset += length;
        return val;
    }

    writeUInt8(val)
    {
        this._offset = this._buf.writeUInt8(val, this._offset);
    }

    writeUInt16BE(val)
    {
        this._offset = this._buf.writeUInt16BE(val, this._offset);
    }

    writeUInt32BE(val)
    {
        this._offset = this._buf.writeUInt32BE(val, this._offset);
    }

    writeUInt64BE(val)
    {
        const int64Val = new Int64(val);
        int64Val.copy(this._buf, this._offset);
        this._offset += 8;
    }

    writeString(str, length)
    {
        if (length === undefined)
            length = str.length;
        this._offset += this._buf.write(str, this._offset, length);
    }

    writeBuffer(buf, start, end)
    {
        this._offset += buf.copy(this._buf, this._offset, start, end);
    }

    readHeaderString()
    {
        const len = this.readUInt8();
        return this.readString(len);
    }

    writeHeaderString(str, length)
    {
        if (length === undefined)
            length = Buffer.byteLength(str);
        this.writeUInt8(length);
        this.writeString(str, length);
    }
}

function isIterable(obj)
{
    if (obj === null || obj === undefined)
        return false;
    return typeof obj[Symbol.iterator] === 'function';
}

function getMessageTypeKey(val)
{
    for (let key in MSG_TYPE)
    {
        if (val === MSG_TYPE[key])
            return key;
    }
    return null;
}

function getContentType(type)
{
    let contentType;
    switch (type)
    {
        case 1: contentType = 'raw'; break;
        case 2: contentType = 'json'; break;
        case 3: contentType = 'string'; break;
        default: contentType = ''; break;
    }
    return contentType;
}

function checkType(type)
{
    return MSG_TYPE[type] ? true : false;
}

function checkContentType(type)
{
    return MSG_CONTENT_TYPE[type] ? true : false;
}

function parsePayloadBuffer(payloadBuf, contentType)
{
    if (contentType === 'raw')
        return payloadBuf;
    else if (contentType === 'json')
    {
        if (payloadBuf.length === 0)
            return null;
        return JSON.parse(payloadBuf.toString('utf8'));
    }
    else
        return payloadBuf.toString('utf8');
}

class Message
{
    constructor(type, id, msgLen, headerLen)
    {
        // public properties
        this.messageLength = msgLen ? msgLen : 0;
        this.headerLength = headerLen ? headerLen : 0;
        this.header = {
            id: id ? id : generateUuid(),
        };

        this.payload = undefined;
        this.payloadBuf = undefined;

        if (type)
            this.setType(type);
    }

    isRequest() {return this.header.type === 'req';}
    isResponse() {return this.header.type === 'res';}
    isPush() {return this.header.type === 'push';}
    isPull() {return this.header.type === 'pull';}
    isPublish() {return this.header.type === 'pub';}
    isSubscribe() {return this.header.type === 'sub';}
    isAck() {return this.header.type === 'ack';}

    getEventName()
    {
        return this.header.topic + '.' + this.header.id;
    }

    setType(type)
    {
        if (!checkType(type))
            throw new TypeError('Invalid message type: ' + type);
        this.header.type = type;
    }

    setContentType(type)
    {
        if (!checkContentType(type))
            throw new TypeError('Invalid message content type: ' + type);
        this.header.contentType = type;
    }

    setPayload(data, contentType)
    {
        if (contentType)
            this.header.contentType = contentType;
        else
            contentType = this.header.contentType;

        this.payload = data;
    }

    setPayloadBuf(buf)
    {
        this.payloadBuf = buf;
    }

    getBuffer()
    {
        const headerBuf = this._getHeaderBuffer();
        this.headerLength = headerBuf.length;
        this.messageLength = 8 + this.headerLength;

        if (!this.payloadBuf && this.payload)
            this.payloadBuf = this._getPayloadBuffer();

        if (this.payloadBuf)
            this.messageLength += this.payloadBuf.length;

        const msgBuf = Buffer.allocUnsafe(this.messageLength);

        msgBuf.writeUInt32BE(this.messageLength);
        msgBuf.writeUInt32BE(this.headerLength, 4);

        // copy header to message buffer
        headerBuf.copy(msgBuf, 8);

        // copy payload to message buffer
        if (this.payloadBuf)
            this.payloadBuf.copy(msgBuf, 8 + this.headerLength);

        return msgBuf;
    }

    _getPayloadBuffer()
    {
        const payload = this.payload;
        const contentType = this.header.contentType;
        let payloadBuf;

        if (!checkContentType(contentType))
            throw new TypeError('Unknown payload content type: ' + contentType);

        if (contentType === 'raw')
        {
            payloadBuf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
        }
        else if (contentType === 'json')
        {
            payloadBuf = Buffer.from(JSON.stringify(payload), 'utf8');
        }
        else if (contentType === 'string')
        {
            payloadBuf = Buffer.from(payload);
        }
        return payloadBuf;
    }
}

class RequestMessage extends Message
{
    constructor(id, msgLen, headerLen)
    {
        super('req', id, msgLen, headerLen);
    }

    createFromBuffer(buf)
    {
        const headerBuf = buf.slice(8, 8 + this.headerLength);

        const headerBufStream = new BufferStream(headerBuf);

        headerBufStream.offset = 9;
        this.header.contentType = getContentType(headerBufStream.readUInt8());
        this.header.error = headerBufStream.readUInt8();

        this.header.topic = headerBufStream.readHeaderString();
        this.header.source = headerBufStream.readHeaderString();
        this.header.target = headerBufStream.readHeaderString();

        this.payloadBuf = buf.slice(8 + this.headerLength, this.messageLength);
        this.payload = parsePayloadBuffer(this.payloadBuf, this.header.contentType);

        return this;
    }

    _getHeaderBuffer()
    {
        const header = this.header;

        const topicLen = Buffer.byteLength(header.topic, 'utf8');
        const sourceLen = Buffer.byteLength(header.source, 'utf8');
        const targetLen = Buffer.byteLength(header.target, 'utf8');
        const headerLen = 14 + topicLen + sourceLen + targetLen;
        const headerBuf = Buffer.alloc(headerLen);

        const bufStream = new BufferStream(headerBuf);
        bufStream.writeUInt64BE(header.id);
        bufStream.writeUInt8(MSG_TYPE[header.type]);
        bufStream.writeUInt8(MSG_CONTENT_TYPE[header.contentType]);
        bufStream.writeUInt8(header.error || 0);
        bufStream.writeHeaderString(header.topic, topicLen);
        bufStream.writeHeaderString(header.source, sourceLen);
        bufStream.writeHeaderString(header.target, targetLen);

        return bufStream.get();
    }

    // helper methods
    setTopic(topic) {this.header.topic = topic; }
    setSource(source) {this.header.source = source; }
    setTarget(target) {this.header.target = target; }
}

class ResponseMessage extends RequestMessage
{
    constructor(id, msgLen, headerLen)
    {
        super(id, msgLen, headerLen);
        this.header.type = 'res';
    }

    isError(name)
    {
        const errCode = ErrorCode[name];
        if (errCode === undefined)
            return false;
        return this.header.error === errCode;
    }

    setError(code)
    {
        if (typeof code !== 'number')
            throw new TypeError('Invalid message error code: ' + code);
        this.header.error = code;
    }
}

class PublishMessage extends Message
{
    constructor(id, msgLen, headerLen)
    {
        super('pub', id, msgLen, headerLen);
    }

    createFromBuffer(buf)
    {
        const headerBuf = buf.slice(8, 8 + this.headerLength);
        const headerBufStream = new BufferStream(headerBuf);

        headerBufStream.offset = 9;
        this.header.contentType = getContentType(headerBufStream.readUInt8());
        this.header.topic = headerBufStream.readHeaderString();
        this.header.target = headerBufStream.readHeaderString();

        this.payloadBuf = buf.slice(8 + this.headerLength, this.messageLength);
        //this.payload = parsePayloadBuffer(this.payloadBuf, this.header.contentType);
        return this;
    }

    _getHeaderBuffer()
    {
        const header = this.header;

        const topicLen = Buffer.byteLength(header.topic, 'utf8');
        const targetLen = Buffer.byteLength(header.target, 'utf8');
        const headerLen = 12 + topicLen + targetLen;
        const headerBuf = Buffer.alloc(headerLen);

        const bufStream = new BufferStream(headerBuf);
        bufStream.writeUInt64BE(header.id);
        bufStream.writeUInt8(MSG_TYPE[header.type]);
        bufStream.writeUInt8(MSG_CONTENT_TYPE[header.contentType]);
        bufStream.writeHeaderString(header.topic, topicLen);
        bufStream.writeHeaderString(header.target, targetLen);

        return bufStream.get();
    }

    setTopic(topic) {this.header.topic = topic; }
    setTarget(target) {this.header.target = target; }
}


class SubscribeMessage extends Message
{
    constructor(id, msgLen, headerLen)
    {
        super('sub', id, msgLen, headerLen);
    }

    createFromBuffer(buf)
    {
        const headerBuf = buf.slice(8, 8 + this.headerLength);
        const headerBufStream = new BufferStream(headerBuf);

        headerBufStream.offset = 9;
        this.header.contentType = getContentType(headerBufStream.readUInt8());
        this.header.topic = headerBufStream.readHeaderString();

        this.payloadBuf = buf.slice(8 + this.headerLength, this.messageLength);
        this.payload = parsePayloadBuffer(this.payloadBuf, this.header.contentType);

        return this;
    }

    _getHeaderBuffer()
    {
        const header = this.header;

        const topicLen = Buffer.byteLength(header.topic, 'utf8');
        const headerLen = 11 + topicLen;
        const headerBuf = Buffer.alloc(headerLen);

        const bufStream = new BufferStream(headerBuf);
        bufStream.writeUInt64BE(header.id);
        bufStream.writeUInt8(MSG_TYPE[header.type]);
        bufStream.writeUInt8(MSG_CONTENT_TYPE[header.contentType]);
        bufStream.writeHeaderString(header.topic, topicLen);

        return bufStream.get();
    }

    setTopic(topic) {this.header.topic = topic; }
}

class PushMessage extends Message
{
    constructor(id, msgLen, headerLen)
    {
        super('push', id, msgLen, headerLen);
        this.payload = [];
        this.items = [];
    }

    createFromBuffer(buf)
    {
        const headerBuf = buf.slice(8, 8 + this.headerLength);
        const headerBufStream = new BufferStream(headerBuf);

        headerBufStream.offset = 9;
        this.header.contentType = getContentType(headerBufStream.readUInt8());
        this.header.topic = headerBufStream.readHeaderString();
        this.header.target = headerBufStream.readHeaderString();
        this.header.itemCount = headerBufStream.readUInt32BE();


        const payloadBuf = buf.slice(8 + this.headerLength, this.messageLength);
        // No need to parse payload
        //this._parsePayloadBuffer(payloadBuf, this.header.contentType);
        // split payload to item array.
        this.items = this._splitPayloadToItems(payloadBuf);
        return this;
    }

    _splitPayloadToItems(payloadBuf)
    {
        const itemCount = this.header.itemCount;
        const payloadSize = payloadBuf.length;
        const bufStream = new BufferStream(payloadBuf);
        const items = [];
        for (let i = 0; i < itemCount; i++)
        {
            let itemLen = bufStream.readUInt32BE();
            if (bufStream.offset + itemLen > payloadSize)
                throw new RangeError('Payload buffer is smaller than expected.');
            let itemBuf = bufStream.readBuffer(itemLen);
            items.push(itemBuf);
        }
        return items;
    }

    _parsePayloadBuffer(payloadBuf, contentType)
    {
        const itemCount = this.header.itemCount;
        const payloadSize = payloadBuf.length;
        const bufStream = new BufferStream(payloadBuf);

        const payload = [];
        if (contentType === 'raw')
        {
            for (let i = 0; i < itemCount; i++)
            {
                let itemLen = bufStream.readUInt32BE();
                if (bufStream.offset + itemLen > payloadSize)
                    throw new RangeError('Payload buffer is smaller than expected.');
                let itemBuf = bufStream.readBuffer(itemLen);
                payload.push(itemBuf);
            }
        }
        else if (contentType === 'json')
        {
            if (itemCount < 1 || payloadBuf.length === 0)
                return [];

            for (let i = 0; i < itemCount; i++)
            {
                let itemLen = bufStream.readUInt32BE();
                if (bufStream.offset + itemLen > payloadSize)
                    throw new RangeError('Payload buffer is smaller than expected.');
                let itemBuf = bufStream.readBuffer(itemLen);
                payload.push(JSON.parse(itemBuf.toString('utf8')));
            }
        }
        else
        {
            for (let i = 0; i < itemCount; i++)
            {
                let itemLen = bufStream.readUInt32BE();
                if (bufStream.offset + itemLen > payloadSize)
                    throw new RangeError('Payload buffer is smaller than expected.');
                let itemBuf = bufStream.readBuffer(itemLen);
                payload.push(itemBuf.toString('utf8'));
            }
        }
        this.payload = payload;
    }

    _getHeaderBuffer()
    {
        const header = this.header;

        const topicLen = Buffer.byteLength(header.topic, 'utf8');
        const targetLen = Buffer.byteLength(header.target, 'utf8');
        const headerLen = 16 + topicLen + targetLen;
        const headerBuf = Buffer.alloc(headerLen);

        const bufStream = new BufferStream(headerBuf);
        bufStream.writeUInt64BE(header.id);
        bufStream.writeUInt8(MSG_TYPE[header.type]);
        bufStream.writeUInt8(MSG_CONTENT_TYPE[header.contentType]);
        bufStream.writeHeaderString(header.topic, topicLen);
        bufStream.writeHeaderString(header.target, targetLen);
        bufStream.writeUInt32BE(header.itemCount);

        return bufStream.get();
    }

    _getPayloadBuffer()
    {
        const payload = this.payload;
        const contentType = this.header.contentType;

        if (!checkContentType(contentType))
            throw new TypeError('Unknown payload content type: ' + contentType);

        if (!isIterable(payload))
            throw new TypeError('payload should be an iterable object.');

        if (payload.length !== this.header.itemCount)
            throw new TypeError('payload length should be equal to itemCount.');

        let itemBufs = [];
        if (contentType === 'raw')
        {
            for (let i in payload)
            {
                let item = payload[i];
                let contentBuf = Buffer.isBuffer(item) ? item : Buffer.from(item);
                let itemBuf = Buffer.allocUnsafe(contentBuf.length + 4);
                itemBuf.writeUInt32BE(contentBuf.length, 0);
                contentBuf.copy(itemBuf, 4);
                itemBufs.push(itemBuf);
            }
        }
        else if (contentType === 'json')
        {
            for (let i in payload)
            {
                let item = payload[i];
                let contentBuf = Buffer.from(JSON.stringify(item), 'utf8');
                let itemBuf = Buffer.allocUnsafe(contentBuf.length + 4);
                itemBuf.writeUInt32BE(contentBuf.length, 0);
                contentBuf.copy(itemBuf, 4);
                itemBufs.push(itemBuf);
            }
        }
        else if (contentType === 'string')
        {
            for (let i in payload)
            {
                let item = payload[i];
                let contentBuf = Buffer.from(item);
                let itemBuf = Buffer.allocUnsafe(contentBuf.length + 4);
                itemBuf.writeUInt32BE(contentBuf.length, 0);
                contentBuf.copy(itemBuf, 4);
                itemBufs.push(itemBuf);
            }
        }

        return Buffer.concat(itemBufs);
    }


    // helper methods
    setTopic(topic) {this.header.topic = topic; }
    setTarget(target) {this.header.target = target; }
    setItemCount(itemCount) {this.header.itemCount = itemCount; }
    setPayload(data, contentType)
    {
        if (!isIterable(data))
            throw new TypeError('payload should be an iterable object.');

        if (contentType)
            this.header.contentType = contentType;
        else
            contentType = this.header.contentType;

        this.payload = data;
        this.header.itemCount = data.length;
    }
}

class PullMessage extends Message
{
    constructor(id, msgLen, headerLen)
    {
        super('pull', id, msgLen, headerLen);
    }

    createFromBuffer(buf)
    {
        const headerBuf = buf.slice(8, 8 + this.headerLength);
        const headerBufStream = new BufferStream(headerBuf);

        headerBufStream.offset = 9;
        this.header.contentType = getContentType(headerBufStream.readUInt8());
        this.header.topic = headerBufStream.readHeaderString();

        const payloadBuf = buf.slice(8 + this.headerLength, this.messageLength);
        this.payload = parsePayloadBuffer(payloadBuf, this.header.contentType);
        return this;
    }

    _getHeaderBuffer()
    {
        const header = this.header;

        const topicLen = Buffer.byteLength(header.topic, 'utf8');
        const headerLen = 11 + topicLen;
        const headerBuf = Buffer.alloc(headerLen);

        const bufStream = new BufferStream(headerBuf);
        bufStream.writeUInt64BE(header.id);
        bufStream.writeUInt8(MSG_TYPE[header.type]);
        bufStream.writeUInt8(MSG_CONTENT_TYPE[header.contentType]);
        bufStream.writeHeaderString(header.topic, topicLen);

        return bufStream.get();
    }

    // helper methods
    setTopic(topic) {this.header.topic = topic; }
}


class AckMessage extends Message
{
    constructor(id, msgLen, headerLen)
    {
        super('ack', id, msgLen, headerLen);
    }

    createFromBuffer(buf)
    {
        const headerBuf = buf.slice(8, 8 + this.headerLength);
        const headerBufStream = new BufferStream(headerBuf);

        headerBufStream.offset = 9;
        this.header.topic = headerBufStream.readHeaderString();

        return this;
    }

    _getHeaderBuffer()
    {
        const header = this.header;

        const topicLen = Buffer.byteLength(header.topic, 'utf8');
        const headerLen = 10 + topicLen;
        const headerBuf = Buffer.alloc(headerLen);

        const bufStream = new BufferStream(headerBuf);
        bufStream.writeUInt64BE(header.id);
        bufStream.writeUInt8(MSG_TYPE[header.type]);
        bufStream.writeHeaderString(header.topic, topicLen);

        return bufStream.get();
    }

    setTopic(topic) {this.header.topic = topic; }
}


// Factory function to create Message object by type.
exports.create = function(type, id)
{
    if (type === 'req')
        return new RequestMessage(id);
    else if (type === 'res')
        return new ResponseMessage(id);
    else if (type === 'push')
        return new PushMessage(id);
    else if (type === 'pull')
        return new PullMessage(id);
    else if (type === 'pub')
        return new PublishMessage(id);
    else if (type === 'sub')
        return new SubscribeMessage(id);
    else if (type === 'ack')
        return new AckMessage(id);
    else
        throw new TypeError(`Message type:${type} is not valid.`);
};


// Factory function to create Message object from buffer
exports.createFromBuffer = function(buf)
{
    // parse new data
    const msgLen = buf.readUInt32BE(0);
    const headerLen = buf.readUInt32BE(4);
    const id = new Int64(buf, 8).toNumber();
    const type = getMessageTypeKey(buf.readUInt8(16, true));

    let msg;
    if (type === 'req')
    {
        msg = new RequestMessage(id, msgLen, headerLen);
    }
    else if (type === 'res')
    {
        msg = new ResponseMessage(id, msgLen, headerLen);
    }
    else if (type === 'push')
    {
        msg = new PushMessage(id, msgLen, headerLen);
    }
    else if (type === 'pull')
    {
        msg = new PullMessage(id, msgLen, headerLen);
    }
    else if (type === 'pub')
    {
        msg = new PublishMessage(id, msgLen, headerLen);
    }
    else if (type === 'sub')
    {
        msg = new SubscribeMessage(id, msgLen, headerLen);
    }
    else if (type === 'ack')
    {
        msg = new AckMessage(id, msgLen, headerLen);
    }
    else
        throw new TypeError(`Message type:${type} is not valid.`);

    msg.createFromBuffer(buf);
    return msg;
};

var debug  = require('debug')('RequestReader')
  , stream = require('stream')
  , util   = require('util')

var CR     = '\r'.charCodeAt(0)
  , DOLLAR = '$'.charCodeAt(0)
  , NL     = '\n'.charCodeAt(0)
  , SPACE  = ' '.charCodeAt(0)
  , STAR   = '*'.charCodeAt(0)
  , ZERO   = '0'.charCodeAt(0)

util.inherits(RequestReader, stream.Transform)
function RequestReader() {
  stream.Transform.call(this, {objectMode: true})
  this._buffer = new Buffer(0)
  this._offset = 0
  this._state  = this._state_start
}

RequestReader.prototype._transform = function(chunk, encoding, done) {
  if (typeof chunk == 'string') {
    chunk = new Buffer(chunk, encoding)
  }
  this._append(chunk)
  this._state(done)
}

RequestReader.prototype._flush = function(done) {
  if (this._state === this._states.START && this._is_empty()) {
    return done()
  }
  done(new Error('terminated with partial data buffered'))
}

RequestReader.prototype._append = function(buffer) {
  this._buffer = Buffer.concat([this._buffer.slice(this._offset), buffer], this._buffer.length + buffer.length - this._offset)
  this._offset = 0
}

RequestReader.prototype._state_start = function(done) {
  this._trim_whitespace()
  if (!this._has_bytes(1)) {
    return done()
  }
  if (this._peek() == STAR) {
    this._state = this._state_arg_count.bind(this, done)
    return setImmediate(this._state)
  }
  return done(new Error('expected *'))
  // TODO handle inline
}

RequestReader.prototype._state_arg_count = function(done) {
  var i
    , index_crnl
    , num

  if ((index_crnl = this._index_of_crnl(this._offset)) == -1) {
    return done()
  }
  this._argc = -1
  // *{count: integers}\r\n
  for (i = this._offset + 1; i < index_crnl; ++i) {
    num = this._int_at(i)
    if (num == -1) {
      return done(new Error('expected number'))
    }
    if (this._argc == -1) {
      this._argc = num
    } else {
      this._argc = (10 * this._argc) + num
    }
    ++i
  }
  if (this._argc == -1) {
    return done(new Error('expected arg count'))
  }
  this._args   = []
  this._offset = index_crnl + 2
  this._state  = this._states.ARG
  return setImmediate(this._state.bind(this, done))
}

RequestReader.prototype._parse_arg = function(done) {
  var arg
    , i
    , index_arg_start
    , index_arg_end
    , index_crnl
    , index_end
    , num
    , length = -1

  if (this._argc == 0) {
    this._state = this._states.START
    this.push(this._args)
    return setImmediate(this._state.bind(this, done))
  }

  if (!this._has_bytes(1)) {
    return done()
  }
  if (this._buffer[this._offset] != DOLLAR) {
    return done(new Error('expected $'))
  }
  // ${length: integers}\r\n{value: buffer(length)}\r\n
  if ((index_crnl = this._index_of_crnl(this._offset)) == -1) {
    return done()
  }
  index_arg_start = index_crnl + 2
  for (i = this._offset + 1; i < index_crnl; ++i) {
    num = this._int_at(i)
    if (num == -1) {
      debug('buffer state:', this._buffer.slice(this._offset).toString())
      return done(new Error('expected number instead found ' + String.fromCharCode(this._buffer[this._offset])))
    }
    if (length == -1) {
      length = num
    } else {
      length = (10 * length) + num
    }
  }
  if (length == -1) {
    return done(new Error('expected argument length'))
  }
  index_arg_end = index_arg_start + length
  index_end     = index_arg_end + 2
  if (index_end > this._buffer.length) {
    return done()
  }
  if (this._buffer[index_arg_end] != CR) {
    return done(new Error('expected carriage return'))
  }
  if (this._buffer[index_arg_end + 1] != NL) {
    return done(new Error('expected newline'))
  }
  this._args.push(this._buffer.slice(index_arg_start, index_arg_end))
  this._offset = index_end
  --this._argc
  return setImmediate(this._state.bind(this, done))
}

RequestReader.prototype._peek = function() {
  return this._buffer[this._offset]
}

RequestReader.prototype._has_bytes = function(num) {
  return this._offset + num < this._buffer.length
}

RequestReader.prototype._index_of_crnl = function(start) {
  var i = start
  while (i < this._buffer.length) {
    if (this._buffer[i] == CR && i + 1 < this._buffer.length && this._buffer[i + 1] == NL) {
      return i
    }
    i++
  }
  return -1
}

RequestReader.prototype._int_at = function(offset) {
  var i = -1
  if (offset < this._buffer.length) {
    i = this._buffer[offset] - ZERO
    if (i < 0 || i >= 10) {
      i = -1
    }
  }
  return i
}

RequestReader.prototype._is_empty = function() {
  return this._offset == this._buffer.length
}

RequestReader.prototype._trim_whitespace = function() {
  var c
    , done = false

  while(this._offset < this._buffer.length && !done) {
    c = this._buffer[this._offset]
    if (c == SPACE || c == CR || c == NL) {
      ++this._offset
    } else {
      done = true
    }
  }
}


util.inherits(Source, stream.Readable)
function Source() {
  stream.Readable.call(this)
}
Source.prototype._read = function(size) {
  var self = this
  // this.push('*2\r\n$2\r\nhi\r\n', 'ascii')
  this.push('*1\r\n$2\r\nhi\r\n*2\r\n$1\r', 'utf8')
  setTimeout(function() {
    self.push('\n1\r\n$4\r\nte\u00f4\r\n', 'utf8')
    setTimeout(function() {
      self.push(null)
    }, 500)
  }, 500)
  
}
var source = new Source()
var rr = new RequestReader()
rr.on('data', function(o) {
  console.log(o.map(function(item) { return item.toString() }))
})
source.pipe(rr)
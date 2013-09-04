var stream = require('stream')
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

RequestReader.prototype._append = function(buffer) {
  this._buffer = Buffer.concat([this._buffer.slice(this._offset), buffer], this._buffer.length + buffer.length - this._offset)
  this._offset = 0
}

RequestReader.prototype._flush = function(done) {
  if (this._state === this._state_start && this._is_empty()) {
    return done()
  }
  done(new Error('terminated with partial data buffered'))
}

RequestReader.prototype._has_bytes = function(num) {
  return this._offset + num < this._buffer.length
}

// _index_CR_NL([start])
RequestReader.prototype._index_CR_NL = function(start) {
  if (typeof start == 'undefined') {
    start = this._offset
  }
  var i = start
  while (i < this._buffer.length) {
    if (this._buffer[i] == CR && i + 1 < this._buffer.length && this._buffer[i + 1] == NL) {
      return i
    }
    ++i
  }
  return -1
}

RequestReader.prototype._index_space = function() {
  var i = this._offset
  while (i < this._buffer.length) {
    if (this._buffer[i] == SPACE) {
      return i
    }
    ++i
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

RequestReader.prototype._parse_int = function(start, end) {
  var i
    , num
    , result = -1

  for (i = start; i < end; ++i) {
    num = this._int_at(i)
    if (num == -1) {
      return -1
    }
    if (result == -1) {
      result = num
    } else {
      result = (10 * result) + num
    }
  }
  return result
}

RequestReader.prototype._state_arg_count = function(done) {
  var index_CR_NL
    , arg_count

  if ((index_CR_NL = this._index_CR_NL()) == -1) {
    return done()
  }
  if (this._buffer[this._offset] != STAR) {
    return done(new Error('expected star'))
  }
  if ((arg_count = this._parse_int(this._offset + 1, index_CR_NL)) == -1) {
    return done(new Error('expected integer'))
  }
  this._offset = index_CR_NL + 2
  this._transition(this._state_args, [], arg_count, done)
}

RequestReader.prototype._state_args = function(memo, arg_count, done) {
  var index_CR_NL
    , index_end
    , length

  if (memo.length == arg_count) {
    this.push(memo)
    return this._transition(this._state_start, done)
  }
  if ((index_CR_NL = this._index_CR_NL()) == -1) {
    return done()
  }
  if (this._buffer[this._offset] != DOLLAR) {
    return done(new Error('expected $'))
  }
  if ((length = this._parse_int(this._offset + 1, index_CR_NL)) == -1) {
    return done(new Error('expected integer'))
  }
  index_end = index_CR_NL + 2 + length + 2
  if (index_end > this._buffer.length) {
    return done()
  }
  if (this._buffer[index_end - 2] != CR || this._buffer[index_end - 1] != NL) {
    return done(new Error('expected CRNL'))
  }
  memo.push(this._buffer.slice(index_CR_NL + 2, index_end - 2))
  this._offset = index_end
  this._transition(this._state_args, memo, arg_count, done)
}

RequestReader.prototype._state_inline = function(memo, done) {
  var index_space
    , index_CR_NL

  this._trim_space()
  if ((index_space = this._index_space()) != -1) {
    memo.push(this._buffer.slice(this._offset, index_space))
    this._offset = index_space + 1
    return this._transition(this._state_inline, memo, done)
  }
  if ((index_CR_NL = this._index_CR_NL()) == -1) {
    return done()
  }
  if (this._offset != index_CR_NL) {
    memo.push(this._buffer.slice(this._offset, index_CR_NL))
  }
  this.push(memo)
  this._offset = index_CR_NL + 2
  this._transition(this._state_start, done)
}

RequestReader.prototype._state_start = function(done) {
  this._trim()
  if (!this._has_bytes(1)) {
    return done()
  }
  if (this._buffer[this._offset] == STAR) {
    return this._transition(this._state_arg_count, done)
  }
  return this._transition(this._state_inline, [], done)
}

RequestReader.prototype._transform = function(chunk, encoding, done) {
  if (typeof chunk == 'string') {
    chunk = new Buffer(chunk, encoding)
  }
  this._append(chunk)
  this._state(done)
}

// _transition(state_fn, [args...], done)
RequestReader.prototype._transition = function() {
  var args     = Array.prototype.slice.call(arguments)
    , state_fn = args.shift()
    , done     = args.pop()
  
  this._state = state_fn
  args.forEach(function(arg) {
    this._state = this._state.bind(this, arg)
  }.bind(this))

  setImmediate(this._state.bind(this), done)
}

RequestReader.prototype._trim = function() {
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

RequestReader.prototype._trim_space = function() {
  var done = false

  while(this._offset < this._buffer.length && !done) {
    if (this._buffer[this._offset] == SPACE) {
      ++this._offset
    } else {
      done = true
    }
  }
}

// util.inherits(CRLF, stream.Transform)
// function CRLF() {
//   stream.Transform.call(this)
// }
// CRLF.prototype._transform = function(chunk, encoding, done) {
//   this.push(chunk.toString().replace(/\n/g, '\r\n'))
//   done()
// }

// var rr = new RequestReader()
// var crlf = new CRLF()
// rr.on('data', function(o) {
//   console.log('o', o)
//   console.log(o.map(function(i) { return i.toString() }))
// })
// process.stdin.pipe(crlf).pipe(rr)

// var net = require('net')
//   , server = net.createServer()

// server.on('connection', function(socket) {
//   console.log('connection accepted')
//   var rr = new RequestReader()
//   rr.on('data', function(o) {
//     console.log('o', o.map(function(i) {return i.toString()}))
//   })
//   socket.pipe(rr)
// })
// server.listen(9999, function() {
//   console.log('listening on :9999')
// })

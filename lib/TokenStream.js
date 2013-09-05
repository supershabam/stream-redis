var debug   = require('debug')('TokenStream')
  , stream  = require('stream')
  , TOKENS  = require('./tokens')
  , util    = require('util')

var CODE_COLON  = ':' .charCodeAt(0)
  , CODE_CR     = '\r'.charCodeAt(0)
  , CODE_DOLLAR = '$' .charCodeAt(0)
  , CODE_MINUS  = '-' .charCodeAt(0)
  , CODE_NINE   = '9' .charCodeAt(0)
  , CODE_NL     = '\n'.charCodeAt(0)
  , CODE_PLUS   = '+' .charCodeAt(0)
  , CODE_SPACE  = ' ' .charCodeAt(0)
  , CODE_STAR   = '*' .charCodeAt(0)
  , CODE_ZERO   = '0' .charCodeAt(0)


util.inherits(TokenStream, stream.Transform)
module.exports = TokenStream
function TokenStream() {
  stream.Transform.call(this, {objectMode: true})
  this._buffer  = new Buffer(0)
  this._context = null
  this._error   = null
  this._offset  = 0
  this._state   = this._state_start
}

TokenStream.prototype._bytes = function(count) {
  return this._offset + count < this._buffer.length
}

TokenStream.prototype._empty = function() {
  return this._offset == this._buffer.length
}

TokenStream.prototype._flush = function(done) {
  if (this._state === this._state_start && this._empty()) {
    return done()
  }
  done(new Error('terminated with partial data buffered'))
}

// _index(Array[int], [start = this._offset])
TokenStream.prototype._index = function(char_codes, start) {
  var i, j

  if (typeof start == 'undefined') {
    start = this._offset
  }

  i = start
  while (i < this._buffer.length) {
    if (this._buffer[i] == char_codes[0]) {
      j = 0
      while (
        i + j < this._buffer.length && 
        j     <   char_codes.length &&
        this._buffer[i + j] == char_codes[j]
      ) { ++j }
      return j == char_codes.length ? i : -1
    }
    ++i
  }
  return -1
}

// _int(start, end) where start and end are within remaining buffer
// must check this._error after calling this function
TokenStream.prototype._int = function(start, end) {
  var i, negate, num, sum

  i      = start
  negate = false
  sum    = 0
  while (i < end) {
    if (this._buffer[i] == CODE_MINUS && i == start) {
      negate = true
    } else {
      num = this._buffer[i] - CODE_ZERO
      if (num < 0 || num >= 10) {
        this._error = new Error('read non-integer digit: ' + String.fromCharCode(this._buffer[i]))
        return -1
      }
      sum = (sum * 10) + num
    }
    ++i
  }
  return negate ? -sum : sum
}

// _ltrim(Array[int])
TokenStream.prototype._ltrim = function(char_codes) {
  var done, i

  done = false
  while (this._offset < this._buffer.length && !done) {
    i = 0
    while (
      i < char_codes.length && 
      this._buffer[this._offset] != char_codes[i]
    ) { ++i}
    if (i < char_codes.length) {
      ++this._offset
    } else {
      done = true
    }
  }
}

TokenStream.prototype._state_bulk = function(done) {
  var end, len, i

  i = this._index([CODE_CR, CODE_NL])
  if (i == -1) {
    return done()
  }
  len = this._int(this._offset + 1, i)
  if (this._error) {
    return done(this._error)
  }
  // NULL bulk reply
  if (len == -1) {
    this.push([TOKENS.BULK, null])
    this._offset = i + 2
    return this._transition(this._state_start, done)
  }
  if (len < 0) {
    return done(new Error('expected positive length bulk reply'))
  }
  end = i + len + 4
  if (end > this._buffer.length) {
    return done()
  }
  if (this._buffer[end - 2] != CODE_CR || this._buffer[end - 1] != CODE_NL) {
    return done(new Error('expected \/r\/n'))
  }
  this.push([TOKENS.BULK, this._buffer.slice(i + 2, end - 2)])
  this._offset = end
  this._transition(this._state_start, done)
}

TokenStream.prototype._state_error = function(done) {
  var i

  i = this._index([CODE_CR, CODE_NL])
  if (i == -1) {
    return done()
  }
  this.push([TOKENS.STATUS, this._buffer.slice(this._offset + 1, i)])
  this._offset = i + 2
  this._transition(this._state_start, done)
}

TokenStream.prototype._state_inline = function(done) {
  var i

  i = this._index([CODE_SPACE])
  if (i != -1) {
    this._context.push(this._buffer.slice(this._offset, i))
    this._offset = i + 1
    this._ltrim([CODE_SPACE])
    return this._transition(this._state_inline, done)
  }
  i = this._index([CODE_CR, CODE_NL])
  if (i == -1) {
    return done()
  }
  if (this._offset != i) {
    this._context.push(this._buffer.slice(this._offset, i))
  }
  this._offset = i + 2
  this.push([TOKENS.MULTI_BULK, this._context.length])
  for (i = 0; i < this._context.length; ++i) {
    this.push([TOKENS.BULK, this._context[i]])
  }
  this._transition(this._state_start, done)
}

TokenStream.prototype._state_integer = function(done) {
  var i, j

  i = this._index([CODE_CR, CODE_NL])
  if (i == -1) {
    return done()
  }
  j = this._offset + 1
  if (this._buffer[j] == CODE_MINUS) {++j}
  for (; j < i; ++j) {
    if (
      this._buffer[j] >= CODE_ZERO &&
      this._buffer[j] <= CODE_NINE
    ) { continue }
    return done(new Error('non-integer character in integer reply: ' + String.fromCharCode(this._buffer[j])))
  }
  this.push([TOKENS.INTEGER, this._buffer.slice(this._offset + 1, i)])
  this._offset = i + 2
  this._transition(this._state_start, done)
}

TokenStream.prototype._state_multi_bulk = function(done) {
  var len, i

  i = this._index([CODE_CR, CODE_NL])
  if (i == -1) {
    return done()
  }
  len = this._int(this._offset + 1, i)
  if (this._error) {
    return done(this._error)
  }
  // NULL multi bulk reply
  if (len == -1) {
    this.push([TOKENS.MULTI_BULK, null])
    this._offset = i + 2
    return this._transition(this._state_start, done)
  }
  if (len < 0) {
    return done(new Error('expected positive length multi bulk reply'))
  }
  this.push([TOKENS.MULTI_BULK, len])
  this._offset = i + 2
  this._transition(this._state_start, done)  
}

TokenStream.prototype._state_reply = function(done) {
  var i

  i = this._index([CODE_CR, CODE_NL])
  if (i == -1) {
    return done()
  }
  this.push([TOKENS.STATUS, this._buffer.slice(this._offset + 1, i)])
  this._offset = i + 2
  this._transition(this._state_start, done)
}

TokenStream.prototype._state_start = function(done) {
  this._ltrim([CODE_CR, CODE_SPACE, CODE_NL])
  if (!this._bytes(1)) {
    return done()
  }
  // my guess at which is most frequent at top
  if (this._buffer[this._offset] == CODE_DOLLAR) {
    return this._transition(this._state_bulk, done)
  }
  if (this._buffer[this._offset] == CODE_STAR) {
    return this._transition(this._state_multi_bulk, done)
  }
  if (this._buffer[this._offset] == CODE_PLUS) {
    return this._transition(this._state_reply, done)
  }
  if (this._buffer[this._offset] == CODE_COLON) {
    return this._transition(this._state_integer, done)
  }
  if (this._buffer[this._offset] == CODE_MINUS) {
    return this._transition(this._state_error, done)
  }
  this._transition(this._state_inline, done)
}

TokenStream.prototype._transform = function(chunk, encoding, done) {
  if (typeof chunk == 'string') {
    chunk = new Buffer(chunk, encoding)
  }

  this._buffer = Buffer.concat([this._buffer.slice(this._offset), chunk], this._buffer.length + chunk.length - this._offset)
  this._offset = 0
  this._state(done)
}

TokenStream.prototype._transition = function(target_state, done) {
  var former_state = this._state
  this._state = target_state
  
  switch(target_state) {
    case this._state_inline:
      if (former_state !== this._state_inline) {
        this._context = []
      }
      break

    default:
      this._context = null
  }
  
  setImmediate(this._state.bind(this), done)
}

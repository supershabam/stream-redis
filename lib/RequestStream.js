var stream = require('stream')
  , TOKENS = require('./tokens')
  , util   = require('util')

util.inherits(RequestStream, stream.Transform)
module.exports = RequestStream
function RequestStream() {
  stream.Transform.call(this, {objectMode: true})
}

RequestStream.prototype._flush = function(done) {
  done()
}

RequestStream.prototype._transform = function(token, _, done) {
  console.log('token', token)
  done()
}

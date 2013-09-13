var util = require('util')

util.inherits(IncompleteBufferError, Error)
module.exports = function IncompleteBufferError(message) {
  this.message = message || ''
}
IncompleteBufferError.prototype.name = 'IncompleteBufferError'


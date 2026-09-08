class ValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ValidationError';
    this.code = code;  // 2-digit error code
  }
}

module.exports = ValidationError;

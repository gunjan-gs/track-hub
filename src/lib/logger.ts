type Level = 'debug' | 'info' | 'warn' | 'error'

function log(level: Level, msg: string, meta?: unknown) {
  if (process.env.NODE_ENV === 'production') return
  const fn = level === 'debug' ? console.debug : level === 'info' ? console.info : level === 'warn' ? console.warn : console.error
  if (meta !== undefined) fn(msg, meta)
  else fn(msg)
}

export const logger = {
  debug: (msg: string, meta?: unknown) => log('debug', msg, meta),
  info: (msg: string, meta?: unknown) => log('info', msg, meta),
  warn: (msg: string, meta?: unknown) => log('warn', msg, meta),
  error: (msg: string, meta?: unknown) => log('error', msg, meta),
}


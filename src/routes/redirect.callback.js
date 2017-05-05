import dns from 'dns'
import parseDomain from 'parse-domain'

import config from '../config'
import RedirectService from '../services/redirect.service'
import StatisticService from '../services/statistic.service'
import LoggerHandler from '../handlers/logger.handler'

/* Router callback */
export default (req, res) => {
  const logger = LoggerHandler
  const statisticService = new StatisticService()

  const host = req.headers.host.split(':')[0]
  let targetHost = host
  let countCalls = 0

  const path = `${host}`
  logger.info(path)

  /* dns.resolve callback */
  const callback = (err, records) => {
    logger.info(`${path} -> CNAME ${targetHost}`)
    countCalls += 1

    if (countCalls > 3) {
      return res.status(508).send('Loop Detected')
    }

    /* handle errors */
    if (err && err.code === 'ENODATA' && parseDomain(targetHost) &&
      parseDomain(targetHost).subdomain.indexOf('redirect') < 0) {
      targetHost = `redirect.${targetHost}`
      logger.info(`${path} -> CNAME pointing to redirect!`)
      return dns.resolve(targetHost, 'CNAME', callback)
    }

    if (!err && records.length > 1) {
      err = {
        code: 'MORETHANONE',
        message: `More than one record on the host ${targetHost}. Found: ${records.join(', ')}`
      }
    }

    if (!err && !parseDomain(records[0])) {
      err = {
        code: 'NOTADOMAIN',
        message: `The record on the host ${targetHost} is not valid. Found: ${records[0]}`
      }
    }

    if (err) {
      const context = {
        config: config,
        err: err,
        targetHost: targetHost
      }

      logger.info(`${path} ERROR: ${err.message}`)
      return res.status(500).render('error.ejs', context)
    }

    /* prepar to redirect */
    const redirectService = new RedirectService(req, res)
    redirectService.perform(records[0]).then((returns) => {
      statisticService.put(returns.hostname)

      /* perform redirect */
      const url = `${returns.protocol}://${returns.hostname}${returns.path}`
      logger.info(`${path} REDIRECT ${returns.statusCode} TO ${url}`)
      return res.redirect(returns.statusCode, url)
    })
  }

  if (parseDomain(host) && !parseDomain(host).subdomain) {
    logger.info(`${path} A:ROOT DOMAIN`)
    targetHost = `redirect.${host}`
  }

  dns.resolve(targetHost, 'CNAME', callback)
}

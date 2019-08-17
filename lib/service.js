const fs = require('fs')
const fetch = require('node-fetch')
const parse = require('./parse')

const DOMAIN = 'https://wwwl12.mitsubishielectric.co.jp/'
const SMART = 'RacEstVis/rac/smart/'
const SET = 'RacEstVis/rac/set/'
const GET = 'RacEstVis/rac/get/'

async function loadAll(secret) {
  const res = await fetch(DOMAIN + GET, {
    method: 'POST',
    headers: {'content-type': 'application/xml'},
    body: getBody('device_list', secret),
  })
  parseCookie(secret, res)

  const aircons = parse.deviceList(await res.text())
  for (const aircon of aircons)
    await getStatus(secret, aircon)
  secret.cookie = null  // session end
  return aircons
}

async function getStatus(secret, aircon) {
  if (!secret.cookie) {
    const res = await fetch(DOMAIN + SET, {
      method: 'POST',
      headers: {'content-type': 'application/xml'},
      body: getBody('auth', secret),
    })
    parseCookie(secret, res)
  }
  const res = await fetch(DOMAIN + SMART, {
    method: 'POST',
    headers: {
      'content-type': 'application/xml',
      'cookie': secret.cookie,
    },
    body: getBody('status', secret, aircon.serial),
  })
  parse.status(aircon, await res.text())
}

function getBody(cmd, secret, serial) {
  const template = fs.readFileSync(`${__dirname}/request_${cmd}.xml`).toString()
  return template.replace('{USER}', secret.user)
                 .replace('{PASS}', secret.pass)
                 .replace('{SERIAL}', serial)
}

function parseCookie(secret, res) {
  clearTimeout(secret.cookieTimeout)
  const raw = res.headers.raw()['set-cookie']
  secret.cookie = raw.map((entry) => entry.split(';')[0]).join(';')
  secret.cookieTimeout = setTimeout(() => { secret.cookie = null }, 60 * 1000)
}

module.exports = {loadAll, getStatus}

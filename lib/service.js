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

async function deviceInfo(secret, aircon) {
  if (!secret.cookie)
    await auth(secret)
  const res = await fetch(DOMAIN + GET, {
    method: 'POST',
    headers: {
      'content-type': 'application/xml',
      'cookie': secret.cookie,
    },
    body: getBody('device', secret, aircon.serial),
  })
  parse.deviceInfo(aircon, await res.text())
}

async function getStatus(secret, aircon) {
  if (!secret.cookie)
    await auth(secret)
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

async function setStatus(secret, aircon) {
  if (!secret.cookie)
    await auth(secret)
  const res = await fetch(DOMAIN + SMART, {
    method: 'POST',
    headers: {
      'content-type': 'application/xml',
      'cookie': secret.cookie,
    },
    body: getBody('set', secret, aircon.serial, parse.encode(aircon)),
  })
  parse.status(aircon, await res.text())
  aircon.lastUpdate = Date.now()
}

async function auth(secret) {
  const res = await fetch(DOMAIN + SET, {
    method: 'POST',
    headers: {'content-type': 'application/xml'},
    body: getBody('auth', secret),
  })
  parseCookie(secret, res)
}

function getBody(cmd, secret, serial, value={}) {
  const template = fs.readFileSync(`${__dirname}/request_${cmd}.xml`).toString()
  return template.replace(/{USER}/g, secret.user)
                 .replace(/{PASS}/g, secret.pass)
                 .replace(/{SERIAL}/g, serial)
                 .replace(/{VALUE1}/g, value.value1)
                 .replace(/{VALUE2}/g, value.value2)
                 .replace(/{OPERATE_KEY}/g, generateOperateKey())
}

function generateOperateKey() {
  const date = new Date
  return '_' + date.getFullYear()
             + (date.getMonth() + 1 + 100).toString().substr(1, 2)
             + (date.getDate() + 100).toString().substr(1, 2)
       + '_' + (date.getHours() + 100).toString().substr(1, 2)
             + (date.getMinutes() + 100).toString().substr(1, 2)
             + (date.getSeconds() + 100).toString().substr(1, 2)
}

function parseCookie(secret, res) {
  clearTimeout(secret.cookieTimeout)
  const raw = res.headers.raw()['set-cookie']
  secret.cookie = raw.map((entry) => entry.split(';')[0]).join(';')
  secret.cookieTimeout = setTimeout(() => { secret.cookie = null }, 50 * 60 * 1000)
}

module.exports = {loadAll, deviceInfo, getStatus, setStatus}

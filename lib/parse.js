const {xml2js} = require('xml-js')

function deviceList(text) {
  const xml = xml2js(text, {compact: true})
  const aircons = []
  for (const data of xml.LSV.GET_RESPONSE.CODE.COMMAND.DATA) {
    const aircon = defaultAircon()
    parseDeviceInfo(aircon, data)
    aircons.push(aircon)
  }
  return aircons
}

function deviceInfo(aircon, text) {
  const xml = xml2js(text, {compact: true})
  parseDeviceInfo(aircon, xml.LSV.GET_RESPONSE.CODE.COMMAND.DATA)
}

function status(aircon, text) {
  const xml = xml2js(text, {compact: true})
  parseCode(aircon, xml.LSV.CODE)
}

function encode(aircon) {
  return {
    value1: encode08Value(aircon),
    value2: encode01Value(aircon),
  }
}

function defaultAircon() {
  return {
    name: 'Mitsubishi Aircon',
    serial: null,
    lastUpdate: null,

    roomTemp: null,
    outsideTemp: null,

    isWatch: false,
    workState: false,
    workMode: null,

    target: {
      heatingTemperature: 23,
      coolingTemperature: 27,
      dehumidity: 'weak',
    },
  }
}

function parseDeviceInfo(aircon, data) {
  aircon.name = data.DEVICE_INFO.DEVICE_NAME._text + 'のエアコン'
  aircon.serial = data.DEVICE_INFO.SERIAL_NO._text
  aircon.target.heatingTemperature = Number(data.DEVICE_PRESET_VALUE_DATA.HEATING_TEMPERATURE._text)
  aircon.target.coolingTemperature = Number(data.DEVICE_PRESET_VALUE_DATA.COOLING_TEMPERATURE._text)
  switch (data.DEVICE_PRESET_VALUE_DATA.DEHUMIDITY._text) {
    case '標準':
      aircon.target.dehumidity = 'normal'
      aircon.target.dryTemperature = 27
      break
    case '強':
      aircon.target.dehumidity = 'strong'
      aircon.target.dryTemperature = 26
      break
    case '弱':
      aircon.target.dehumidity = 'weak'
      aircon.target.dryTemperature = 28
      break
  }
}

function parseCode(aircon, code) {
  for (const {_text} of code.VALUE) {
    parse08Value(aircon, _text)
  }
  for (const {_text} of code.VALUE) {
    parse02Value(aircon, _text)
    parse03Value(aircon, _text)
  }
}

function parse08Value(aircon, value) {
  if (value.substr(2, 2) !== '62' || value.substr(10, 2) !== '09')
    return
  if (hex2bin(value.substr(20, 2)).substr(5, 1) === '1')
    aircon.isWatch = true
  else
    aircon.isWatch = false
}

function parse02Value(aircon, value) {
  if (value.substr(2, 2) !== '62' || value.substr(10, 2) !== '02')
    return
  if (value.substr(16, 2) === '00')
    aircon.workState = false
  else
    aircon.workState = true
  switch (value.substr(18, 2).toLowerCase()) {
    case '01':
    case '09':
      aircon.workMode = 'heat'
      break
    case '03':
    case '0b':
      aircon.workMode = 'cool'
      break
    case '00':
    case '02':
    case '0a':
    case '0c':
      aircon.workMode = 'dehumidity'
      const humidity = Math.floor(parseInt(value.substr(34, 2), 16) / 10)
      if (humidity >= 6)
        aircon.target.dehumidity = 'weak'
      else if (humidity == 5)
        aircon.target.dehumidity = 'normal'
      else
        aircon.target.dehumidity = 'strong'
      break
    case '07':
      aircon.workMode = 'blow'
      break
    case '08':
      aircon.workMode = 'auto'
      break
  }
}

function parse03Value(aircon, value) {
  if (value.substr(2, 2) !== '62' || value.substr(10, 2) !== '03')
    return
  aircon.roomTemp = (parseInt(value.substr(24, 2), 16) - 0x80) / 2
  if (parseInt(value.substr(20, 2), 16) < 16)
    return
  aircon.outsideTemp = (parseInt(value.substr(20, 2), 16) - 0x80) / 2
}

function encode08Value(aircon) {
  const loc2 = '4101301008'
  let loc3 = '1'
  if (aircon.workMode === 'dehumidity')
    loc3 += '4'
  else if (aircon.workMode === 'cool' || aircon.workMode === 'heat')
    loc3 += '8'
  else
    loc3 += '0'
  const loc4 = '00'
  const loc5 = '00'
  let loc6 = '00'
  if (aircon.target.dehumidity === 'weak')
    loc6 = '3C'
  else if (aircon.target.dehumidity === 'normal')
    loc6 = '32'
  else if (aircon.target.dehumidity === 'strong')
    loc6 = '28'
  if (aircon.workMode !== 'dehumidity')
    loc6 = '00'
  const loc7 = '0A'
  const loc8 = '00'
  const loc9 = '01'
  const loc10 = '0000000000000000'
  const value = loc2 + loc3 + loc4 + loc5 + loc6 + loc7 + loc8 + loc9 + loc10
  return 'fc' + value + calcFCC(value)
}

function encode01Value(aircon) {
  const hasTemperature = aircon.workMode === 'cool' || aircon.workMode === 'heat'
  const loc2 = '4101301001'
  const loc3 = hasTemperature ? '07' : '03'
  const loc4 = '02'
  const loc5 = aircon.workState ? '01' : '00'
  const loc6 = `0${workModeToNumber(aircon.workMode)}`
  const loc7 = getTargetTemperature(aircon)
  const loc8 = (31 - Math.floor(loc7)).toString(16)
  const loc9 = (loc7 * 10).toString().substr(-1, 1) === '0' ? '0' : '1'
  const loc10 = hasTemperature ? loc9 + loc8 : '08'
  const loc11 = '0000000000000000'
  const loc13 = hasTemperature ? (loc7 * 2 + 128).toString(16) : 'AE'
  const loc14 = '42'
  const value = loc2 + loc3 + loc4 + loc5 + loc6 + loc10 + loc11 + loc13 + loc14
  return 'fc' + value + calcFCC(value)
}

function workModeToNumber(workMode) {
  if (workMode === 'heat')
    return 1
  if (workMode === 'cool')
    return 3
  if (workMode === 'dehumidity')
    return 2
  if (workMode === 'blow')
    return 7
  if (workMode === 'auto')
    return 8
  return 0
}

function getTargetTemperature(aircon) {
  if (aircon.workMode === 'heat')
    return aircon.target.heatingTemperature
  else
    return aircon.target.coolingTemperature
}

function calcFCC(value) {
  let loc5 = ''
  let loc2 = 0
  let loc3 = 0
  while (loc3 < 20) {
    loc5 = value.substr(loc3 * 2, 2)
    loc2 = loc2 + parseInt(loc5, 16)
    loc3++
  }
  loc2 = loc2 % 256
  loc2 = 256 - loc2
  let loc4 = loc2.toString(16)
  if (loc4.length === 1)
    loc4 = '0' + loc4
  return loc4
}

function hex2bin(hex) {
  return (parseInt(hex, 16).toString(2)).padStart(8, '0')
}

module.exports = {deviceList, deviceInfo, status, encode}

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

function status(aircon, text) {
  const xml = xml2js(text, {compact: true})
  parseCode(aircon, xml.LSV.CODE)
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
      break
    case '強':
      aircon.target.dehumidity = 'strong'
      break
    case '弱':
      aircon.target.dehumidity = 'weak'
      break
  }
}

function parseCode(aircon, code) {
  for (const {_text} of code.VALUE) {
    parse09Value(aircon, _text)
  }
  for (const {_text} of code.VALUE) {
    parse02Value(aircon, _text)
    parse03Value(aircon, _text)
  }
}

function parse09Value(aircon, value) {
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

function hex2bin(hex) {
  return (parseInt(hex, 16).toString(2)).padStart(8, '0')
}

module.exports = {deviceList, status}

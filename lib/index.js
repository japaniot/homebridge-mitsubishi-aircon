const packageJson = require('../package.json')

const fs = require('fs')
const path = require('path')
const service = require('./service')

// Lazy-initialized.
let Accessory, hap

// Storage.
let storagePath = null
let storage = {accessories: {}}

// Called by homebridge.
module.exports = (homebridge) => {
  Accessory = homebridge.platformAccessory
  hap = homebridge.hap

  // Path to settings.
  storagePath = path.join(homebridge.user.storagePath(), 'persist', 'MitsubishiAircon.json')

  // Register the platform.
  homebridge.registerPlatform(packageJson.name, "MitsubishiAircon", MitsubishiAircon, true)
}

class MitsubishiAircon {
  constructor(log, config, api) {
    this.log = log
    this.config = config
    this.api = api

    if (!this.config.user || !this.config.pass) {
      this.log('Must set "user" and "pass".')
      return
    }

    readSettings(this)

    this.accessories = new Map
    this.api.once('didFinishLaunching', () => this._init())
  }

  configureAccessory(accessory) {
    // Save the accessory and build later.
    accessory.updateReachability(false)
    this.accessories.set(accessory.UUID, accessory)
  }

  configurationRequestHandler(context, request, callback) {
  }

  async _init() {
    // Load all accessories.
    const aircons = await service.loadAll(this.config)
    for (const aircon of aircons) {
      await this._addAccesory(aircon, hap.uuid.generate(aircon.serial))
      aircon.lastUpdate = Date.now()
    }

    // Removed unreachable accessories.
    for (const [uuid, accessory] of this.accessories) {
      if (!accessory.reachable) {
        this.log(`Deleteing non-available accessory ${uuid}`)
        this.accessories.delete(uuid)
        this.api.unregisterPlatformAccessories(packageJson.name, "MitsubishiAircon", [accessory])
        delete storage.accessories[uuid]
      }
    }
    writeSettings(this)
  }

  async _addAccesory(aircon, uuid) {
    const registered = this.accessories.has(uuid)
    const accessory = registered ? this.accessories.get(uuid)
                                 : new Accessory(aircon.name, uuid)

    await this._buildAccessory(aircon, accessory)
    accessory.updateReachability(true)
    accessory.once('identify', (paired, callback) => callback())

    if (!registered) {
      this.log(`Found new accessory: ${aircon.name} ${uuid}`)
      this.accessories.set(uuid, accessory)
      this.api.registerPlatformAccessories(packageJson.name, "MitsubishiAircon", [accessory])
      storage.accessories[uuid] = aircon
    }
  }

  async _buildAccessory(aircon, accessory) {
    const service = accessory.getService(hap.Service.HeaterCooler) ||
                    accessory.addService(hap.Service.HeaterCooler)

    service.getCharacteristic(hap.Characteristic.Active)
    .on('set', async (value, callback) => {
      try {
        // Set
        callback()
      } catch (e) {
        callback(e)
      }
    })
    .on('get', async (callback) => {
      try {
        await this._updateIfNeeded(aircon)
        callback(null, aircon.workState)
      } catch (e) {
        this.log(`Failed to get state: ${e}`)
        callback(e)
      }
    })

    service.getCharacteristic(hap.Characteristic.CurrentHeaterCoolerState)
    .on('get', async (callback) => {
      try {
        await this._updateIfNeeded(aircon)
        let mode = hap.Characteristic.CurrentHeaterCoolerState.INACTIVE
        if (!aircon.workState)
          mode = hap.Characteristic.CurrentHeaterCoolerState.INACTIVE
        else if (aircon.workMode === 'cool' ||
                 aircon.workMode === 'blow' ||
                 aircon.workMode === 'dehumidity')
          mode = hap.Characteristic.CurrentHeaterCoolerState.COOLING
        else if (aircon.workMode === 'heat')
          mode = hap.Characteristic.CurrentHeaterCoolerState.HEATING
        else if (aircon.workMode === 'auto')
          mode = aircon.roomTemp > aircon.target.heatingTemperature ?
                 hap.Characteristic.CurrentHeaterCoolerState.COOLING :
                 hap.Characteristic.CurrentHeaterCoolerState.HEATING
        else
          this.log(`Unknown state ${aircon.workMode}`)
        callback(null, mode)
      } catch (e) {
        this.log(`Failed to get state: ${e}`)
        callback(e)
      }
    })

    service.getCharacteristic(hap.Characteristic.TargetHeaterCoolerState)
    .on('set', async (value, callback) => {
      try {
        // Set
        callback()
      } catch (e) {
        callback(e)
      }
    })
    .on('get', async (callback) => {
      try {
        await this._updateIfNeeded(aircon)
        let state = hap.Characteristic.TargetHeaterCoolerState.INACTIVE
        if (!aircon.workState)
          state = hap.Characteristic.TargetHeaterCoolerState.OFF
        else if (aircon.workMode === 'cool' ||
                 aircon.workMode === 'blow' ||
                 aircon.workMode === 'dehumidity')
          state = hap.Characteristic.TargetHeaterCoolerState.COOL
        else if (aircon.workMode === 'heat')
          state = hap.Characteristic.TargetHeaterCoolerState.HEAT
        else if (aircon.workMode === 'auto')
          state = hap.Characteristic.TargetHeaterCoolerState.AUTO
        else
          this.log(`Unknown state: ${aircon.workMode}`)
        callback(null, state)
      } catch (e) {
        this.log(`Failed to get state: ${e}`)
        callback(e)
      }
    })

    service.getCharacteristic(hap.Characteristic.CurrentTemperature)
    .on('get', async (callback) => {
      try {
        await this._updateIfNeeded(aircon)
        callback(null, aircon.roomTemp)
      } catch (e) {
        this.log(`Failed to get current temperature: ${e}`)
        callback(e)
      }
    })

    const temperatureSetter = async (name, value, callback) => {
      try {
        // Set
        callback()
      } catch (e) {
        callback(e)
      }
    }
    const temperatureGetter = async (name, callback) => {
      try {
        await this._updateIfNeeded(aircon)
        callback(null, aircon.target[name + 'ingTemperature'])
      } catch (e) {
        this.log(`Failed to get temperature: ${e}`)
        callback(e)
      }
    }
    service.getCharacteristic(hap.Characteristic.CoolingThresholdTemperature)
    .setProps({minValue: 16, maxValue: 30, minStep: 1})
    .on('set', temperatureSetter.bind(null, 'cool'))
    .on('get', temperatureGetter.bind(null, 'cool'))
    service.getCharacteristic(hap.Characteristic.HeatingThresholdTemperature)
    .setProps({minValue: 16, maxValue: 30, minStep: 1})
    .on('set', temperatureSetter.bind(null, 'heat'))
    .on('get', temperatureGetter.bind(null, 'heat'))
  }

  async _updateIfNeeded(aircon) {
    if (Date.now() - aircon.lastUpdate < 5 * 1000)
      return
    await service.getStatus(this.config, aircon)
    console.log('update', aircon)
    aircon.lastUpdate = Date.now()
  }
}

function readSettings(platform) {
  try {
    storage = JSON.parse(fs.readFileSync(storagePath))
  } catch (e) {
    platform.log(`Failed to read settings: ${e}`)
  }
}

function writeSettings(platform) {
  try {
    fs.writeFileSync(storagePath, JSON.stringify(storage))
  } catch (e) {
    platform.log(`Failed to write settings: ${e}`)
  }
}
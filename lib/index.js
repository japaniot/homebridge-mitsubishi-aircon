const packageJson = require('../package.json')

const fs = require('fs')
const path = require('path')
const intervalPromise = require('interval-promise')
const remoteService = require('./service')

// Lazy-initialized.
let Accessory, hap

// Called by homebridge.
module.exports = (homebridge) => {
  Accessory = homebridge.platformAccessory
  hap = homebridge.hap

  // Register the platform.
  homebridge.registerPlatform(packageJson.name, "MitsubishiAircon", MitsubishiAircon, true)
}

class MitsubishiAircon {
  constructor(log, config, api) {
    this.log = log
    this.config = config
    this.api = api

    if (!this.config)  // no configuration
      return

    if (!this.config.user || !this.config.pass) {
      this.log('Must set "user" and "pass".')
      return
    }

    this.sendStatusTimeout = null
    this.accessories = new Map
    this.api.once('didFinishLaunching', () => this._init())
  }

  configureAccessory(accessory) {
    if (!this.accessories)
      return

    // Save the accessory and build later.
    this.accessories.set(accessory.UUID, accessory)
  }

  configurationRequestHandler(context, request, callback) {
  }

  async _init() {
    // Load all accessories.
    const aircons = await remoteService.loadAll(this.config)
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
      }
    }
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
    }
  }

  async _buildAccessory(aircon, accessory) {
    const service = accessory.getService(hap.Service.HeaterCooler) ||
                    accessory.addService(hap.Service.HeaterCooler)

    aircon.updateInterval = intervalPromise(async () => {
      try {
        await this._updateIfNeeded(aircon)
      } catch (e) {
        this.log('Failed to update in interval callback.')
        return  // ignore error
      }
      service.getCharacteristic(hap.Characteristic.CurrentTemperature)
             .updateValue(aircon.roomTemp)
      service.getCharacteristic(hap.Characteristic.CoolingThresholdTemperature)
             .updateValue(this.config.useDryForCool ? aircon.target.dryTemperature
                                                    : aircon.target.coolingTemperature)
      service.getCharacteristic(hap.Characteristic.HeatingThresholdTemperature)
             .updateValue(aircon.target.heatingTemperature)
    }, 60 * 1000)

    service.getCharacteristic(hap.Characteristic.Active)
    .on('set', async (value, callback) => {
      try {
        if (aircon.workState != value) {
          aircon.workState = value
          await this._sendNewStatus(aircon)
        }
        callback()
      } catch (e) {
        this.log(`Unable to set: ${e}`)
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
        if (!aircon.workState) {
          mode = hap.Characteristic.CurrentHeaterCoolerState.INACTIVE
        } else if (aircon.workMode === 'cool' ||
                   aircon.workMode === 'dehumidity') {
          mode = hap.Characteristic.CurrentHeaterCoolerState.COOLING
          if (aircon.workMode === 'cool' &&
              aircon.target.coolingTemperature >= aircon.roomTemp) {
            mode = hap.Characteristic.CurrentHeaterCoolerState.IDLE
          }
        } else if (aircon.workMode === 'blow') {
          mode = hap.Characteristic.CurrentHeaterCoolerState.IDLE
        } else if (aircon.workMode === 'heat') {
          mode = hap.Characteristic.CurrentHeaterCoolerState.HEATING
          if (aircon.target.heatingTemperature <= aircon.roomTemp)
            mode = hap.Characteristic.CurrentHeaterCoolerState.IDLE
        } else if (aircon.workMode === 'auto') {
          if (aircon.roomTemp < aircon.target.heatingTemperature)
            mode = hap.Characteristic.CurrentHeaterCoolerState.HEATING
          else if (aircon.roomTemp > aircon.target.coolingTemperature)
            mode = hap.Characteristic.CurrentHeaterCoolerState.COOLING
          else
            mode = hap.Characteristic.CurrentHeaterCoolerState.IDLE
        } else {
          this.log(`Unknown state: ${aircon.workMode}`)
        }
        callback(null, mode)
      } catch (e) {
        this.log(`Failed to get state: ${e}`)
        callback(e)
      }
    })

    service.getCharacteristic(hap.Characteristic.TargetHeaterCoolerState)
    .on('set', async (value, callback) => {
      try {
        let newMode = aircon.workState ? aircon.workMode : false
        if (value === hap.Characteristic.TargetHeaterCoolerState.COOL)
          newMode = this.config.useDryForCool ? 'dehumidity' : 'cool'
        else if (value === hap.Characteristic.TargetHeaterCoolerState.HEAT)
          newMode = 'heat'
        else
          newMode = 'auto'
        if (aircon.workMode != newMode) {
          if (newMode)
            aircon.workMode = newMode
          else
            aircon.workState = false
          await this._sendNewStatus(aircon)
        }
        callback()
      } catch (e) {
        this.log(`Unable to set: ${e}`)
        callback(e)
      }
    })
    .on('get', async (callback) => {
      try {
        await this._updateIfNeeded(aircon)
        let state = hap.Characteristic.TargetHeaterCoolerState.AUTO
        if (aircon.workMode === 'cool' ||
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
    .setProps({minValue: 0, maxValue: 50, minStep: 0.5})
    .on('get', async (callback) => {
      try {
        await this._updateIfNeeded(aircon)
        callback(null, aircon.roomTemp)
      } catch (e) {
        this.log(`Failed to get current temperature: ${e}`)
        callback(e)
      }
    })

    service.getCharacteristic(hap.Characteristic.CoolingThresholdTemperature)
    .setProps({minValue: 16, maxValue: 30, minStep: 0.5})
    .on('set', async (value, callback) => {
      try {
        const newTarget = {
          coolingTemperature: value,
          dehumidity: aircon.target.dehumidity,
          dryTemperature: aircon.target.dryTemperature,
        }
        if (this.config.useDryForCool) {
          if (value >= 28) {
            newTarget.dehumidity = 'weak'
            newTarget.dryTemperature = 28
          } else if (value >= 27) {
            newTarget.dehumidity = 'normal'
            newTarget.dryTemperature = 27
          } else {
            newTarget.dehumidity = 'strong'
            newTarget.dryTemperature = 26
          }
        }
        if (aircon.target.coolingTemperature != newTarget.coolingTemperature ||
            aircon.target.dehumidity != newTarget.dehumidity ||
            aircon.target.dryTemperature != newTarget.dryTemperature) {
          Object.assign(aircon.target, newTarget)
          await this._sendNewStatus(aircon)
        }
        callback()
      } catch (e) {
        this.log(`Unable to set cool temperature: ${e}`)
        callback(e)
      }
    })
    .on('get', async (callback) => {
      try {
        await this._updateIfNeeded(aircon)
        callback(null, aircon.workMode === 'dehumidity' ? aircon.target.dryTemperature
                                                        : aircon.target.coolingTemperature)
      } catch (e) {
        this.log(`Failed to get cool temperature: ${e}`)
        callback(e)
      }
    })

    service.getCharacteristic(hap.Characteristic.HeatingThresholdTemperature)
    .setProps({minValue: 16, maxValue: 30, minStep: 0.5})
    .on('set', async (value, callback) => {
      try {
        if (aircon.target.heaingTemperature != value) {
          aircon.target.heaingTemperature = value
          await this._sendNewStatus(aircon)
        }
        callback()
      } catch (e) {
        this.log(`Unable to set heat temperature: ${e}`)
        callback(e)
      }
    })
    .on('get', async (callback) => {
      try {
        await this._updateIfNeeded(aircon)
        callback(null, aircon.target.heatingTemperature)
      } catch (e) {
        this.log(`Failed to get heat temperature: ${e}`)
        callback(e)
      }
    })
  }

  async _sendNewStatus(aircon) {
    // Clear pending new status if there is one.
    if (this.sendStatusTimeout)
      clearTimeout(this.sendStatusTimeout)
    // Delay sending new status to avoid flooding.
    this.sendStatusTimeout = setTimeout(() => {
      this.sendStatusTimeout = null
      remoteService.setStatus(this.config, aircon)
    }, 3000)
  }

  _updateIfNeeded(aircon) {
    if (!aircon.updatePromise) {
      aircon.updatePromise = this._doUpdateIfNeeded(aircon).finally(() => {
        aircon.updatePromise = null
      })
    }
    return aircon.updatePromise
  }

  async _doUpdateIfNeeded(aircon) {
    if (Date.now() - aircon.lastUpdate < 30 * 1000)
      return
    try {
      await remoteService.deviceInfo(this.config, aircon)
      await remoteService.getStatus(this.config, aircon)
    } catch (e) {
      this.config.cookie = null
      this.log(`Error when updating ${e}`)
      throw e
    } finally {
      aircon.lastUpdate = Date.now()
    }
  }
}

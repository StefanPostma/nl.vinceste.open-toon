'use strict';

const Homey = require('homey');
const rp = require('request-promise-native');
const WebAPIDevice = require('homey-wifidriver').WebAPIDevice;
const API_BASE_URL = '';
const TEMPERATURE_STATES = {
	comfort: 0,
	home: 1,
	sleep: 2,
	away: 3,
	none: -1
};

/**
 * TODO: GET webhooks before registering a new one
 */
class ToonDevice extends WebAPIDevice {

	/**
	 * This method will be called when a new device has been added
	 * or when the driver reboots with installed devices. It creates
	 * a new ToonAPI client and sets the correct agreement.
	 */
	async onInit() {
		this.log('name:', this.getName());
		this.log('class:', this.getClass());

		// Store raw data
		this.gasUsage = {};
		this.water = {};
		this.powerUsage = {};
		this.thermostatInfo = {};

		// Register capability listeners
		this.registerCapabilityListener('temperature_state', this.onCapabilityTemperatureState.bind(this));
		this.registerCapabilityListener('target_temperature', this.onCapabilityTargetTemperature.bind(this));

		// Fetch initial data
		await this.getStatusUpdate();
		await this.getStatusUpdatePowerUsage();
		//await this.getWater();
		await this.getWaterTest();
		await this.getStatusUpdateTotals();

		this.log('init ToonDevice');
	}

	/**
	 * This method will be called when the target temperature needs to be changed.
	 * @param temperature
	 * @param options
	 * @returns {Promise}
	 */
	onCapabilityTargetTemperature(temperature, options) {
		this.log('onCapabilityTargetTemperature()', 'temperature:', temperature, 'options:', options);
		return this.setTargetTemperature(Math.round(temperature * 2) / 2);
	}

	/**
	 * This method will be called when the temperature state needs to be changed.
	 * @param state
	 * @param resumeProgram Abort or resume program
	 * @returns {Promise}
	 */
	onCapabilityTemperatureState(state, resumeProgram) {
		this.log('onCapabilityTemperatureState()', 'state:', state, 'resumeProgram:', resumeProgram);
		return this.updateState(state, resumeProgram);
	}

	/**
	 * This method will retrieve temperature, gas and electricity data from the Toon API.
	 * @returns {Promise}
	 */
	async getStatusUpdate() {

		try {
			/**
			 * This method will retrieve temperature and state data from the Toon API.
			 * @returns {Promise}
			 */
			return rp({
				method: 'GET',
				url: 'http://' + this.getSetting('address') + '/happ_thermstat?action=getThermostatInfo',
				json: true
			}).then(data => {
				this.log('{getStatusUpdate} opgehaalde data van update, ', data);
				this._processStatusUpdate(data);
			}).catch( err => {
				if( err.error ) {
				this.error('failed to retrieve status update', err.message);
				}
			})
		} catch (err) {
			this.error('failed to retrieve status update', err.message);
		}
	}

	/**
	 * This method will retrieve electricity data from the Toon API.
	 * @returns {Promise}
	 */
	async getStatusUpdatePowerUsage() {

		try {
			/**
			 * This method will retrieve power usage data from the Toon API.
			 * @returns {Promise}
			 */
			return rp({
				method: 'GET',
				url: 'http://' + this.getSetting('address') + '/happ_pwrusage?action=GetCurrentUsage',
				json: true
			}).then(data => {
				this.log('{getStatusUpdatePowerUsage} opgehaalde data van update, ', data);
				this._processStatusUpdate(data);
			}).catch( err => {
				if( err.error ) {
				this.error('failed to retrieve status update', err.message);
				}
			})
		} catch (err) {
			this.error('failed to retrieve status update', err.message);
		}

	}

	/**
	 * This method will retrieve electricity and gas data from the Toon API.
	 * @returns {Promise}
	 */
	async getStatusUpdateTotals() {

		var data = '{"result":"ok","water": {"flow":0, "value":1668, "avgValue":200}}'
        console.log(data)
		try {
			/**
			 * This method will retrieve power usage data from the Toon API.
			 * @returns {Promise}
			 */
			return rp({
				method: 'GET',
				url: 'http://' + this.getSetting('address') + '/hdrv_zwave?action=getDevices.json',
				json: true
			}).then(data => {
				this.log('{getStatusUpdateTotals} opgehaalde data van update, ', data);
				this._processStatusUpdate(data);
			}).catch( err => {
				if( err.error ) {
				this.error('failed to retrieve status update', err.message);
				}
			})
		} catch (err) {
			this.error('failed to retrieve status update', err.message);
		}

	}
	
	/**
	 * This method will retrieve water data from the Toon.
	 * by oepi-loepi
	 * @returns {Promise}
	 *  {\"result\":\"ok\",\"water\": {\"flow\":0, \"value\":1668, \"avgValue\":200}}
	 */
	async getWater() {
		try {
			return rp({
				method: 'GET',
				url: 'http://' + this.getSetting('address') + '/mobile/water_mobile.json',
				json: true
			}).then(data => {
				this.log('{getWater} opgehaalde data van update, ', data);
				this._processStatusUpdate(data);
			}).catch( err => {
				if( err.error ) {
				this.error('failed to retrieve status update', err.message);
				}
			})
		} catch (err) {
			this.error('failed to retrieve status update', err.message);
		}
	}

	async getWaterTest() {
		this.log('Sending Water data');
		const data = '{"result":"ok","water": {"flow":0, "value":1668, "avgValue":200}}';
		this._processStatusUpdate(data);

	}	
	

	/**
	 * Set the state of the device, overrides the program.
	 * @param state ['away', 'home', 'sleep', 'comfort']
	 * @param keepProgram - if true program will resume after state change
	 */
	async updateState(state, keepProgram) {
		const stateId = TEMPERATURE_STATES[state];
		//const data = { ...this.thermostatInfo, activeState: stateId, programState: keepProgram ? 2 : 0 };

		this.log(`set state to ${stateId} (${state}), data: {activeState: ${stateId}}`);

		// by default we keep the program and change the state temporarly
		try {
			return rp({
				method: 'GET',
				// Paul Heeringa: Fixed typo in URL
				url: 'http://' + this.getSetting('address') + '/happ_thermstat?action=changeSchemeState&state=2&temperatureState='+ stateId,
				json: true
			}).then(data => {
				this.log('Reponse set nieuwe state, ', data);
				//this._processStatusUpdate(data);
			}).catch( err => {
				if( err.error ) {
					throw new Error( err.error.error || err.error );
				}
				throw err;
			})
		} catch (err) {
			this.error('failed to set status update', err.message);
		}

		this.log(`success setting temperature state to ${state} (${stateId})`);
		return state;
	}

	/**
	 * PUTs to the Toon API to set a new target temperature
	 * TODO doesn't work flawlessly every time (maybe due to multiple webhooks coming in simultaneously)
	 * @param temperature temperature attribute of type integer.
	 */
	async setTargetTemperature(temperature) {
		const data = { ...this.thermostatInfo, currentSetpoint: temperature * 100, programState: 2, activeState: -1 };

		this.log(`set target temperature to ${temperature}`);

		if (!temperature) {
			this.error('no temperature provided');
			return Promise.reject(new Error('missing_temperature_argument'));
		}

		this.setCapabilityValue('target_temperature', temperature);
		try {
			return rp({
				method: 'GET',
				url: 'http://' + this.getSetting('address') + '/happ_thermstat?action=setSetpoint&Setpoint='+ temperature * 100,
				json: true
			}).then(data => {
				this.log('Reponse set nieuwe tempratuur, ', data);
				//	this._processStatusUpdate(data);
			}).catch( err => {
				if( err.error ) {
					throw new Error( err.error.error || err.error );
				}
				throw err;
			})
		} catch (err) {
			this.error('failed to set status update', err.message);
		}
	}

	/**
	 * Enable the temperature program.
	 * @returns {*}
	 */
	enableProgram() {
		this.log('try to enable program');
		try {
			return rp({
				method: 'GET',
				url: 'http://' + this.getSetting('address') + '/happ_thermstat?action=changeSchemeState&state=1',
				json: true
			}).then(data => {
				this.log('program enabled, ', data);
			}).catch( err => {
				if( err.error ) {
					throw new Error( err.error.error || err.error );
				}
				throw err;
			})
		} catch (err) {
			this.error('failed to enable program', err.message);
		}

	}

	/**
	 * Disable the temperature program.
	 * @returns {*}
	 */
	disableProgram() {
		this.log('try to disable program');
		try {
			return rp({
				method: 'GET',
				url: 'http://' + this.getSetting('address') + '/happ_thermstat?action=changeSchemeState&state=0',
				json: true
			}).then(data => {
				this.log('program disabled, ', data);
			}).catch( err => {
				if( err.error ) {
					throw new Error( err.error.error || err.error );
				}
				throw err;
			})
		} catch (err) {
			this.error('failed to disable program', err.message);
		}
	}

	/**
	 * Method that handles processing an incoming status update, whether it is from a GET /status request or a webhook
	 * update.
	 * @param data
	 * @private
	 */
	_processStatusUpdate(data) {
		this.log('_processStatusUpdate', new Date().getTime());

		// Data needs to be unwrapped
			const dataRootObject = data;

			// Check for power usage information
			// update powerusage with new extra call
			if (dataRootObject.hasOwnProperty('powerUsage')) {
				this.log ('Update power usage')
			 	this._processPowerUsageData(dataRootObject.powerUsage);
			}

			// Check for gas usage information
			if (dataRootObject.hasOwnProperty('dev_2.1')) {
				this.log ('Update gas usage')
			 	this._processGasUsageData(dataRootObject['dev_2.1'].CurrentGasQuantity);
			}

			// Check for power usage information
			if (dataRootObject.hasOwnProperty('dev_2.4') || dataRootObject.hasOwnProperty('dev_2.6')) {
				this.log ('Update gas usage')
			 	this._processPowerUsageData(dataRootObject);
			}

			// Check for water information by oepi-loepi
			if (dataRootObject.hasOwnProperty('water')) {
				this.log ('Update water usage')
			 	this._processWaterData(dataRootObject.water);
			}
			
			// Check for thermostat information
			if (dataRootObject.hasOwnProperty('currentTemp') && dataRootObject.hasOwnProperty('currentSetpoint')) {
				this.log ('Update thermostatinfo usage')
				this._processThermostatInfoData(dataRootObject);
			}
	}

	/**
	 * Method that handles the parsing of updated power usage data.
	 * @param data
	 * @private
	 */
	_processPowerUsageData(data = {}) {
		this.log('process received powerUsage data');
		
		// Store data object
		this.powerUsage = data;

		// Store new values
		if (data.hasOwnProperty('value')) {
			this.log('getThermostatData() -> powerUsage -> measure_power -> value:', data.value);
			this.setCapabilityValue('measure_power', data.value);
		}

		// Store new values
		if (data.hasOwnProperty('dayUsage') && data.hasOwnProperty('dayLowUsage')) {
			const usage = (data.dayUsage + data.dayLowUsage) / 1000; // convert from Wh to KWh
			this.log('getThermostatData() -> powerUsage -> meter_power -> dayUsage:', data.dayUsage + ', dayLowUsage:' + data.dayLowUsage + ', usage:' + usage);
			this.setCapabilityValue('meter_power', usage);
		}

		// Paul Heeringa: Power meter - Peak
		if (data['dev_2.4'].hasOwnProperty('CurrentElectricityQuantity')) {
			// If there is only one tariff, 2.4 = 'NaN' and 2.2 should be used
			if (data['dev_2.4'].CurrentElectricityQuantity != 'NaN') {
				const usage2 = Math.trunc(data['dev_2.4'].CurrentElectricityQuantity / 1000); // convert from Wh to KWh
				this.log('getThermostatData() -> powerUsage -> meter_power -> CurrentElectricityQuantity(Peak):', data['dev_2.4'].CurrentElectricityQuantity);
				this.setCapabilityValue('meter_power.peak', usage2);
			} else {
				const usage2 = Math.trunc(data['dev_2.2'].CurrentElectricityQuantity / 1000); // convert from Wh to KWh
				this.log('getThermostatData() -> powerUsage -> meter_power -> CurrentElectricityQuantity(SingleTariff):', data['dev_2.2'].CurrentElectricityQuantity);
				this.setCapabilityValue('meter_power.peak', usage2);
			}
		}

		// Paul Heeringa: Power meter - Off peak
		if (data['dev_2.6'].hasOwnProperty('CurrentElectricityQuantity')) {
			// If there is only one tariff, 2.6 = 'NaN'
			if (data['dev_2.6'].CurrentElectricityQuantity != 'NaN') {
				const usage3 = Math.trunc(data['dev_2.6'].CurrentElectricityQuantity / 1000); // convert from Wh to KWh
				this.log('getThermostatData() -> powerUsage -> meter_power -> CurrentElectricityQuantity(OffPeak):', data['dev_2.6'].CurrentElectricityQuantity );
				this.setCapabilityValue('meter_power.offPeak', usage3);
			}
		}

	}

	/**
	 * Method that handles the parsing of water data.
	 * by oepi-loepi
	 */
	_processWaterData(data = {}) {
		this.log('process received water data');

		// Store data object
		this.water = data;
		
		// Store new values
		if (data.hasOwnProperty('flow')) {
			const waterflow = data.flow
			this.log('getThermostatData() -> waterFlow :' +  waterflow);
			this.setCapabilityValue('measure_water', waterflow);
		}

		// Store new values
		if (data.hasOwnProperty('value')) {
			const waterquantity = data.value;
			this.log('getThermostatData() -> waterquantity:' + waterquantity);
			this.setCapabilityValue('meter_water', waterquantity);
		}

	}



	/**
	 * Method that handles the parsing of updated gas usage data.
	 * TODO: validate this method once GasUsage becomes available.
	 * @param data
	 * @private
	 * Paul Heeringa: Removed check and round value
	 */
	_processGasUsageData(data = {}) {
		this.log('process received gasUsage data');

		// Store data object
		this.gasUsage = data;

		// Store new values
		// Paul Heeringa: Instead of the day usage, the meter value is applied
			const meterGas = Math.trunc(data / 1000); // L -> m3
			this.log('getThermostatData() -> gasUsage -> meter_gas', meterGas);
			this.setCapabilityValue('meter_gas', meterGas);
	}

	/**
	 * Method that handles the parsing of thermostat info data.
	 * @param data
	 * @private
	 */
	_processThermostatInfoData(data = {}) {
		this.log('process received thermostatInfo data');

		// Store data object
		this.thermostatInfo = data;
		try {
			const dataObject = data;
			this.log('received currentSetpoint data', dataObject.currentSetpoint);

			// Store new values
			if (dataObject.hasOwnProperty('currentTemp')) {
				this.setCapabilityValue('measure_temperature', Math.round((dataObject.currentTemp / 100) * 10) / 10);
					this.log('received currentDisplayTemp data', dataObject.currentTemp);
			}
			if (dataObject.hasOwnProperty('currentSetpoint')) {
				this.setCapabilityValue('target_temperature', Math.round((dataObject.currentSetpoint / 100) * 10) / 10);
				this.log('received currentSetpoint data', dataObject.currentSetpoint);
			}
			if (dataObject.hasOwnProperty('activeState')) {
				// Paul Heeringa: Parsed variable "dataObject.activeState" as int, else it the getKey class would return "undefined".
				this.setCapabilityValue('temperature_state', ToonDevice.getKey(TEMPERATURE_STATES, parseInt(dataObject.activeState)));
				this.log('received activeState data', dataObject.activeState, "(", ToonDevice.getKey(TEMPERATURE_STATES, parseInt(dataObject.activeState)),")");
			}
		} catch (err) {
			this.error('failed to parse data input', err.message);
		}
	}

	/**
	 * This method will be called when the device has been deleted, it makes
	 * sure the client is properly destroyed and loeft over settings are removed.
	 */
	onDeleted() {
		this.log('onDeleted()');
		super.onDeleted();
	}

	/**
	 * Method that overrides device.setAvailable to reset a unavailable counter.
	 * @returns {*|Promise}
	 */
	setAvailable() {
		this._unavailableCounter = 0;
		if (this.getAvailable() === false) {
			this.log('mark as available');
			return super.setAvailable();
		}
		return Promise.resolve();
	}

	/**
	 * Method that overrides device.setUnavailable so that the super only gets called when setUnavailable is called
	 * more than three times.
	 * @param args
	 * @returns {*}
	 */
	setUnavailable(message, callback, force) {
		if (this._unavailableCounter > 3 || force) {
			this.log('mark as unavailable');
			return super.setUnavailable(message, callback);
		}
		this._unavailableCounter = this._unavailableCounter + 1;
		return Promise.resolve();
	}

	/**
	 * Response handler middleware, which will be called on each successful API request.
	 * @param res
	 * @returns {*}
	 */
	webAPIResponseHandler(res) {
		// Mark device as available after being unavailable
		if (this.getAvailable() === false) this.setAvailable();
		return res;
	}

	/**
	 * Response handler middleware, which will be called on each failed API request.
	 * @param err
	 * @returns {*}
	 */
	webAPIErrorHandler(err) {
		this.error('webAPIErrorHandler()', err);

		// Detect error that is returned when Toon is offline
		if (err.name === 'WebAPIServerError' && err.statusCode === 500) {

			if (err.errorResponse.type === 'communicationError' || err.errorResponse.errorCode === 'communicationError' ||
				err.errorResponse.description === 'Error communicating with Toon') {
				this.log('webAPIErrorHandler() -> communication error');
				this.setUnavailable(Homey.__('offline'));

				throw err;
			}
		}

		// Let OAuth2/WebAPIDevice handle the error
		super.webAPIErrorHandler(err);
	}

	/**
	 * Utility method that will return the first key of an object that matches a provided value.
	 * @param obj
	 * @param val
	 * @returns {string | undefined}
	 */
	static getKey(obj, val) {
		return Object.keys(obj).find(key => obj[key] === val);
	}


}

// Returns a function, that, as long as it continues to be invoked, will not
// be triggered. The function will be called after it stops being called for
// N milliseconds. If `immediate` is passed, trigger the function on the
// leading edge, instead of the trailing.
function debounce(func, wait, immediate) {
	var timeout;
	return function () {
		var context = this, args = arguments;
		var later = function () {
			timeout = null;
			if (!immediate) func.apply(context, args);
		};
		var callNow = immediate && !timeout;
		clearTimeout(timeout);
		timeout = setTimeout(later, wait);
		if (callNow) func.apply(context, args);
	};
};

module.exports = ToonDevice;

'use strict';

const Homey = require('homey');
const ToonDevice = require('./device.js');

class ToonDriver extends Homey.Driver  {

	onPair(socket) {
    socket.on('testConnection', function(data, callback) {
			try {
				const data = "test toon";
				//await ToonDevice.apiCallGet({ uri: 'http://' + data.address + '/happ_thermstat?action=getThermostatInfo' });

				let result = {
					updateDataSet: data
				}

				callback(null, result);
			} catch (error) {
				callback(error, null);
			}
		});
	}

	/**
	 * This method will be called when the driver initializes, it initializes Flow Cards.
	 */
	onInit() {

		this.homey.flow.getConditionCard('temperature_state_is')
			.registerRunListener(args => Promise.resolve(args.device.getCapabilityValue('temperature_state') === args.state));

		this.homey.flow.getActionCard('set_temperature_state')
			.registerRunListener(args => args.device.onCapabilityTemperatureState(args.state, (args.resume_program)));

		this.homey.flow.getActionCard('enable_program')
			.registerRunListener(args => args.device.enableProgram());

		this.homey.flow.getActionCard('disable_program')
			.registerRunListener(args => args.device.disableProgram());

		this.homey.flow.getActionCard('update_status')
			.registerRunListener(args => args.device.getStatusUpdate());

		this.homey.flow.getActionCard('update_powerusage')
			.registerRunListener(args => args.device.getStatusUpdatePowerUsage());

		/*
		* Method water by oepi-loepi
		*/

		this.homey.flow.getActionCard('update_water')
			.registerRunListener(args => args.device.getWater());

		this.homey.flow.getActionCard('update_metertotals')
			.registerRunListener(args => args.device.getStatusUpdateTotals());

		this.log('onInit() -> complete, Flow Cards registered');
	}

	/**
	 * Always use ToonDevice as device for this driver.
	 * @returns {ToonDevice}
	 */
	mapDeviceClass() {
		return ToonDevice;
	}
}

module.exports = ToonDriver;

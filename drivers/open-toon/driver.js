'use strict';

const Homey = require('homey');

const ToonDevice = require('./device.js');
// const OAuth2Driver = require('homey-wifidriver').OAuth2Driver;

// const oauth2ClientConfig = {
// 	url: `https://api.toon.eu/authorize?response_type=code&redirect_uri=https://callback.athom.com/oauth2/callback/&client_id=${Homey.env.TOON_KEY}&tenant_id=eneco`,
// 	tokenEndpoint: 'https://api.toon.eu/token',
// 	key: Homey.env.TOON_KEY,
// 	secret: Homey.env.TOON_SECRET,
// 	allowMultipleAccounts: true,
// };

// const API_BASE_URL = 'https://api.toon.eu/toon/v3/';

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

		new Homey.FlowCardCondition('temperature_state_is')
			.register()
			.registerRunListener(args => Promise.resolve(args.device.getCapabilityValue('temperature_state') === args.state));

		new Homey.FlowCardAction('set_temperature_state')
			.register()
			//.registerRunListener(args => args.device.onCapabilityTemperatureState(args.state, (args.resume_program === 'yes')));
			.registerRunListener(args => args.device.onCapabilityTemperatureState(args.state, (args.resume_program)));

		new Homey.FlowCardAction('enable_program')
			.register()
			.registerRunListener(args => args.device.enableProgram());

		new Homey.FlowCardAction('disable_program')
			.register()
			.registerRunListener(args => args.device.disableProgram());

		new Homey.FlowCardAction('update_status')
			.register()
			.registerRunListener(args => args.device.getStatusUpdate());

		new Homey.FlowCardAction('update_powerusage')
			.register()
			.registerRunListener(args => args.device.getStatusUpdatePowerUsage());

		new Homey.FlowCardAction('update_metertotals')
			.register()
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

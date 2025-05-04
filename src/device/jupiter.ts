import { BuildMessageFn, globalPollInterval, registerDeviceDefinition } from '../deviceDefinition';
import { CommandParams, JupiterDeviceData, JupiterTimePeriod, WeekdaySet } from '../types';
import {
  buttonComponent,
  numberComponent,
  selectComponent,
  sensorComponent,
  switchComponent,
  textComponent,
} from '../homeAssistantDiscovery';
import { transformBoolean } from './helpers';
import { isB2500RuntimeInfoMessage } from './b2500Base';

/**
 * Command types supported by the Venus device
 */
enum CommandType {
  READ_DEVICE_INFO = 1, // -> ele_d=160,ele_m=2004,ele_y=0,pv1_p=123,pv1_s=1,pv2_p=109,pv2_s=1,pv3_p=71,pv3_s=1,pv4_p=104,pv4_s=1,grd_o=396,grd_t=1,gct_s=1,cel_s=2,cel_p=353,cel_c=69,err_t=0,wor_m=1,tim_0=12|0|23|59|127|800|1,tim_1=0|0|12|0|127|150|1,tim_2=0|0|0|0|255|0|0,tim_3=0|0|0|0|255|0|0,tim_4=0|0|0|0|255|0|0,cts_m=0,grd_d=175,grd_m=1908,dev_n=134,dev_i=106,dev_m=206,dev_b=209,dev_t=110,wif_s=75,ala_c=0,ful_d=1,ssid=JuliArne,stop_s=10,htt_p=0,ct_t=4,phase_t=1,dchrg=1,seq_s=3
  SET_WORKING_MODE = 2,
  SET_TIME_PERIOD = 3,
  SET_DEVICE_TIME = 4,
  FACTORY_RESET = 5,
  UPGRADE_FIRMWARE = 9,
  GET_FC41D_INFO = 10, // -> wifi_v=202409090159
  ENABLE_BACKUP = 11,
  GET_BMS_INFO = 14, // -> b_ver=212,b_chv=571,b_rci=1000,b_rdi=1000,b_soc=65,b_soh=100,b_cap=5120,b_vol=5223,b_cur=-94,b_tem=250,b_chf=192,b_slf=0,b_cpc=332,b_err=0,b_war=0,b_ret=102482070,b_ent=0,b_mot=23,b_tp1=18,b_tp2=19,b_tp3=18,b_tp4=19,b_vo1=3265,b_vo2=3265,b_vo3=3265,b_vo4=3265,b_vo5=3264,b_vo6=3264,b_vo7=3265,b_vo8=3265,b_vo9=3264,b_vo10=3265,b_vo11=3264,b_vo12=3265,b_vo13=3265,b_vo14=3265,b_vo15=3264,b_vo16=3262
  SET_VERSION = 15,
  SET_MAX_CHARGING_POWER = 16,
  SET_MAX_DISCHARGE_POWER = 17,
  SET_METER_TYPE = 18,
  GET_CT_POWER = 19,
  UPGRADE_FC4_MODULE = 20,
}

/**
 * Process a command for the Venus device
 *
 * @param command - Command type
 * @param params - Command parameters
 * @returns Formatted command string
 */
function processCommand(command: CommandType, params: CommandParams = {}): string {
  const entries = Object.entries(params);
  return `cd=${command}${entries.length > 0 ? ',' : ''}${entries.map(([key, value]) => `${key}=${value}`).join(',')}`;
}

function bitMaskToWeekdaySet(weekdayBitMask: number) {
  return '0123456'
    .split('')
    .filter((_, index) => weekdayBitMask & (1 << index))
    .join('') as WeekdaySet;
}

/**
 * Parse a time period string from the device
 *
 * @param value - Time period string (format: "HH|MM|HH|MM|CYCLE|POWER|ENABLED")
 * @returns Parsed time period object
 */
function parseTimePeriod(value: string): NonNullable<JupiterDeviceData['timePeriods']>[number] {
  const parts = value.split('|');
  if (parts.length < 7) {
    return {
      startTime: '00:00',
      endTime: '00:00',
      weekday: '0123456',
      power: 0,
      enabled: false,
    };
  }

  let weekdayBitMask = parseInt(parts[4], 10);
  const weekday = bitMaskToWeekdaySet(weekdayBitMask);
  return {
    startTime: `${parseInt(parts[0], 10)}:${parseInt(parts[1], 10).toString().padStart(2, '0')}`,
    endTime: `${parseInt(parts[2], 10)}:${parseInt(parts[3], 10).toString().padStart(2, '0')}`,
    weekday: weekday,
    power: parseInt(parts[5], 10),
    enabled: parts[6] === '1',
  };
}

function weekdaySetToBitMask(weekday: JupiterTimePeriod['weekday']): number {
  return weekday.split('').reduce((mask, day) => mask | (1 << parseInt(day, 10)), 0);
}

/**
 * Extract additional device info for Home Assistant discovery
 *
 * @param state - Device state
 * @returns Additional device info
 */
function extractAdditionalDeviceInfo(state: JupiterDeviceData) {
  return {
    firmwareVersion: state.deviceVersion?.toString(),
  };
}

const requiredRuntimeInfoKeys = [
  'cel_p',
  'cel_c',
  'ele_d',
  'ele_m',
  'ele_y',
  'pv1_p',
  'pv1_s',
  'pv2_p',
  'pv2_s',
  'pv3_p',
  'pv3_s',
  'pv4_p',
  'pv4_s',
  'grd_d',
  'grd_m',
  'grd_o',
  'grd_t',
  'gct_s',
  'cel_s',
  'err_t',
  'dev_n',
  'dev_i',
  'dev_m',
  'dev_b',
  'dev_t',
  'wor_m',
  'tim_0',
  'tim_1',
  'tim_2',
  'tim_3',
  'tim_4',
  'cts_m',
  'wif_s',
  'ala_c',
  'ful_d',
  'ssid',
  'stop_s',
  'htt_p',
  'ct_t',
  'phase_t',
  'dchrg',
  'seq_s'
];

function isJupiterRuntimeInfoMessage(values: Record<string, string>): boolean {
  return requiredRuntimeInfoKeys.every(key => key in values);
}

registerDeviceDefinition(
  {
    deviceTypes: ['HMN'],
  },
  ({ message }) => {
    registerRuntimeInfoMessage(message);
  },
);

function registerRuntimeInfoMessage(message: BuildMessageFn) {
  let options = {
    refreshDataPayload: 'cd=1',
    isMessage: isJupiterRuntimeInfoMessage,
    publishPath: 'data',
    defaultState: {},
    getAdditionalDeviceInfo: extractAdditionalDeviceInfo,
    pollInterval: globalPollInterval,
  };
  message<JupiterDeviceData>(options, ({ field, command, advertise }) => {
    advertise(
      ['timestamp'],
      sensorComponent<string>({
        id: 'timestamp',
        name: 'Last Update',
        device_class: 'timestamp',
        icon: 'mdi:clock-time-four-outline',
      }),
    );

    // Battery information
    field({
      key: 'cel_p',
      path: ['batteryCapacity'],
      transform: v => parseFloat(v) * 10, // Convert to Wh
    });
    advertise(
      ['batteryCapacity'],
      sensorComponent<number>({
        id: 'battery_capacity',
        name: 'Battery Capacity',
        device_class: 'energy_storage',
        unit_of_measurement: 'Wh',
      }),
    );

    field({
      key: 'cel_c',
      path: ['batterySoc'],
    });
    advertise(
      ['batterySoc'],
      sensorComponent<number>({
        id: 'battery_soc',
        name: 'Battery State of Charge',
        device_class: 'battery',
        unit_of_measurement: '%',
      }),
    );



 
    field({
      key: 'ele_d',
      path: ['dailyChargingCapacity'],
      transform: v => parseFloat(v) / 100, // Convert to kWh
    });
    advertise(
      ['dailyChargingCapacity'],
      sensorComponent<number>({
        id: 'daily_charging_capacity',
        name: 'Daily Charging Capacity',
        device_class: 'energy',
        unit_of_measurement: 'kWh',
        state_class: 'total',
      }),
    );

    field({
      key: 'ele_m',
      path: ['monthlyChargingCapacity'],
      transform: v => parseFloat(v) / 100, // Convert to kWh
    });
    advertise(
      ['monthlyChargingCapacity'],
      sensorComponent<number>({
        id: 'monthly_charging_capacity',
        name: 'Monthly Charging Capacity',
        device_class: 'energy',
        unit_of_measurement: 'kWh',
        state_class: 'total',
      }),
    );

    field({
      key: 'grd_d',
      path: ['dailyDischargeCapacity'],
      transform: v => parseFloat(v) / 100, // Convert to kWh
    });
    advertise(
      ['dailyDischargeCapacity'],
      sensorComponent<number>({
        id: 'daily_discharge_capacity',
        name: 'Daily Discharge Capacity',
        device_class: 'energy',
        unit_of_measurement: 'kWh',
        state_class: 'total',
      }),
    );

    field({
      key: 'grd_m',
      path: ['monthlyDischargeCapacity'],
      transform: v => parseFloat(v) / 100, // Convert to kWh
    });
    advertise(
      ['monthlyDischargeCapacity'],
      sensorComponent<number>({
        id: 'monthly_discharge_capacity',
        name: 'Monthly Discharge Capacity',
        device_class: 'energy',
        unit_of_measurement: 'kWh',
        state_class: 'total',
      }),
    );



    field({
      key: 'grd_o',
      path: ['combinedPower'],
    });
    advertise(
      ['combinedPower'],
      sensorComponent<number>({
        id: 'combined_power',
        name: 'Combined Power',
        device_class: 'power',
        unit_of_measurement: 'W',
      }),
    );

    field({
      key: 'pv1_p',
      path: ['photovoltaikString1'],
    });
    advertise(
      ['photovoltaikString1'],
      sensorComponent<number>({
        id: 'photovoltaik_string1',
        name: 'PV String 1',
        device_class: 'power',
        unit_of_measurement: 'W',
      }),
    );

    field({
      key: 'pv2_p',
      path: ['photovoltaikString2'],
    });
    advertise(
      ['photovoltaikString2'],
      sensorComponent<number>({
        id: 'photovoltaik_string2',
        name: 'PV String 2',
        device_class: 'power',
        unit_of_measurement: 'W',
      }),
    );

    field({
      key: 'pv3_p',
      path: ['photovoltaikString3'],
    });
    advertise(
      ['photovoltaikString3'],
      sensorComponent<number>({
        id: 'photovoltaik_string3',
        name: 'PV String 3',
        device_class: 'power',
        unit_of_measurement: 'W',
      }),
    );

    field({
      key: 'pv4_p',
      path: ['photovoltaikString4'],
    });
    advertise(
      ['photovoltaikString4'],
      sensorComponent<number>({
        id: 'photovoltaik_string4',
        name: 'PV String 4',
        device_class: 'power',
        unit_of_measurement: 'W',
      }),
    );

    field({
      key: 'grd_t',
      path: ['workingStatus'],
      transform: v => {
        switch (v) {
          case '0':
            return 'sleep';
          case '1':
            return 'standby';
          case '2':
            return 'charging';
          case '3':
            return 'discharging';
          case '4':
            return 'backup';
          case '5':
            return 'upgrading';
          case '6':
            return 'bypass';
          default:
            return 'standby';
        }
      },
    });
    advertise(
      ['workingStatus'],
      sensorComponent<NonNullable<JupiterDeviceData['workingStatus']>>({
        id: 'working_status',
        name: 'Working Status',
        icon: 'mdi:state-machine',
        valueMappings: {
          sleep: 'Sleep Mode',
          standby: 'Standby',
          charging: 'Charging',
          discharging: 'Discharging',
          backup: 'Backup Mode',
          upgrading: 'OTA Upgrade',
          bypass: 'Bypass Status',
        },
      }),
    );

    // CT information
    field({
      key: 'gct_s',
      path: ['ctStatus'],
      transform: v => {
        switch (v) {
          case '0':
            return 'notConnected';
          case '1':
            return 'connected';
          case '2':
            return 'weakSignal';
          default:
            return 'notConnected';
        }
      },
    });
    advertise(
      ['ctStatus'],
      sensorComponent<NonNullable<JupiterDeviceData['ctStatus']>>({
        id: 'ct_status',
        name: 'CT Status',
        icon: 'mdi:connection',
        valueMappings: {
          notConnected: 'Not Connected',
          connected: 'Connected',
          weakSignal: 'Weak Signal',
        },
      }),
    );

    // Battery status
    field({
      key: 'cel_s',
      path: ['batteryWorkingStatus'],
      transform: v => {
        switch (v) {
          case '1':
            return 'notWorking';
          case '2':
            return 'charging';
          case '3':
            return 'discharging';
          default:
            return 'unknown';
        }
      },
    });
    advertise(
      ['batteryWorkingStatus'],
      sensorComponent<NonNullable<JupiterDeviceData['batteryWorkingStatus']>>({
        id: 'battery_working_status',
        name: 'Battery Working Status',
        icon: 'mdi:battery',
        valueMappings: {
          notWorking: 'Not Working',
          charging: 'Charging',
          discharging: 'Discharging',
          unknown: 'Unknown',
        },
      }),
    );

    // Error codes
    field({
      key: 'err_t',
      path: ['errorCode'],
    });
    advertise(
      ['errorCode'],
      sensorComponent<number>({
        id: 'error_code',
        name: 'Error Code',
        icon: 'mdi:alert-circle',
      }),
    );

    field({
      key: 'err_a',
      path: ['warningCode'],
    });
    advertise(
      ['warningCode'],
      sensorComponent<number>({
        id: 'warning_code',
        name: 'Warning Code',
        icon: 'mdi:alert',
      }),
    );

    // Device information
    field({
      key: 'dev_n',
      path: ['deviceVersion'],
    });
    advertise(
      ['deviceVersion'],
      sensorComponent<number>({
        id: 'device_version',
        name: 'Device Version',
        icon: 'mdi:information',
      }),
    );


    field({
      key: 'wor_m',
      path: ['workingMode'],
      transform: v => {
        switch (v) {
          case '0':
            return 'automatic';
          case '1':
            return 'manual';
          default:
            return 'automatic';
        }
      },
    });
    advertise(
      ['workingMode'],
      selectComponent<NonNullable<JupiterDeviceData['workingMode']>>({
        id: 'working_mode',
        name: 'Working Mode',
        icon: 'mdi:cog',
        command: 'working-mode',
        valueMappings: {
          automatic: 'Automatic',
          manual: 'Manual',
        },
      }),
    );

    field({
      key: 'wifi_n',
      path: ['wifiName'],
      transform: v => v,
    });
    advertise(
      ['wifiName'],
      sensorComponent<string>({
        id: 'wifi_name',
        name: 'WiFi Name',
        icon: 'mdi:wifi',
      }),
    );

    // Time periods
    for (let i = 0; i < 10; i++) {
      field({
        key: `tim_${i}`,
        path: ['timePeriods', i, 'startTime'],
        transform: v => parseTimePeriod(v).startTime,
      });
      advertise(
        ['timePeriods', i, 'startTime'],
        textComponent({
          id: `time_period_${i}_start_time`,
          name: `Time Period ${i} Time From`,
          command: `time-period/${i}/start-time`,
          pattern: '^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$',
        }),
      );

      field({
        key: `tim_${i}`,
        path: ['timePeriods', i, 'endTime'],
        transform: v => parseTimePeriod(v).endTime,
      });
      advertise(
        ['timePeriods', i, 'endTime'],
        textComponent({
          id: `time_period_${i}_end_time`,
          name: `Time Period ${i} Time To`,
          command: `time-period/${i}/end-time`,
          pattern: '^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$',
        }),
      );

      field({
        key: `tim_${i}`,
        path: ['timePeriods', i, 'enabled'],
        transform: v => parseTimePeriod(v).enabled,
      });
      advertise(
        ['timePeriods', i, 'enabled'],
        switchComponent({
          id: `time_period_${i}_enabled`,
          name: `Time Period ${i} Enabled`,
          icon: 'mdi:clock-time-four-outline',
          command: `time-period/${i}/enabled`,
        }),
      );

      field({
        key: `tim_${i}`,
        path: ['timePeriods', i, 'power'],
        transform: v => parseTimePeriod(v).power,
      });
      advertise(
        ['timePeriods', i, 'power'],
        numberComponent({
          id: `time_period_${i}_power`,
          name: `Time Period ${i} Power`,
          icon: 'mdi:flash',
          unit_of_measurement: 'W',
          command: `time-period/${i}/power`,
          min: -2500,
          max: 2500,
          step: 1,
        }),
      );

      field({
        key: `tim_${i}`,
        path: ['timePeriods', i, 'weekday'],
        transform: v => parseTimePeriod(v).weekday,
      });
      advertise(
        ['timePeriods', i, 'weekday'],
        textComponent<WeekdaySet>({
          id: `time_period_${i}_weekday`,
          name: `Time Period ${i} Weekday`,
          command: `time-period/${i}/weekday`,
          pattern: '^0?1?2?3?4?5?6?$',
        }),
      );
    }

    // Additional settings
    field({
      key: 'cts_m',
      path: ['autoSwitchWorkingMode'],
      transform: v => v === '1',
    });
    advertise(
      ['autoSwitchWorkingMode'],
      switchComponent({
        id: 'auto_switch_working_mode',
        name: 'Auto Switch Working Mode',
        icon: 'mdi:auto-fix',
        command: 'auto-switch-working-mode',
      }),
    );

    // command('auto-switch-working-mode', {
    //   handler: ({ message, publishCallback }) => {
    //     const enabled = message.toLowerCase() === 'true' || message === '1' || message === 'ON';
    //     // This command is not explicitly documented, but inferred from the data structure
    //     publishCallback(processCommand(CommandType.SET_WORKING_MODE, { cts_m: enabled ? 1 : 0 }));
    //   },
    // });

    command('refresh', {
      handler: ({ message, publishCallback }) => {
        if (message.toLowerCase() === 'true' || message === '1' || message === 'PRESS') {
          publishCallback(processCommand(CommandType.READ_DEVICE_INFO));
        }
      },
    });
    advertise(
      [],
      buttonComponent({
        id: 'refresh',
        name: 'Refresh',
        icon: 'mdi:refresh',
        command: 'refresh',
        payload_press: 'PRESS',
        enabled_by_default: false,
      }),
    );

    // command('factory-reset', {
    //   handler: ({ message, publishCallback }) => {
    //     if (message.toLowerCase() === 'true' || message === '1' || message === 'PRESS') {
    //       // rs=1 restores factory settings and clears accumulated data
    //       // rs=2 restores factory settings without clearing accumulated data
    //       publishCallback(processCommand(CommandType.FACTORY_RESET, { rs: 2 }));
    //     }
    //   },
    // });
    // advertise(
    //   [],
    //   buttonComponent({
    //     id: 'factory_reset',
    //     name: 'Factory Reset',
    //     icon: 'mdi:delete-forever',
    //     command: 'factory-reset',
    //     payload_press: 'PRESS',
    //     enabled_by_default: false,
    //   }),
    // );

    command('sync-time', {
      handler: ({ message, publishCallback }) => {
        if (message.toLowerCase() === 'true' || message === '1' || message === 'PRESS') {
          const now = new Date();
          publishCallback(
            processCommand(CommandType.SET_DEVICE_TIME, {
              yy: now.getFullYear(),
              mm: now.getMonth(),
              rr: now.getDate(),
              hh: now.getHours(),
              mn: now.getMinutes(),
            }),
          );
        }
      },
    });
    advertise(
      [],
      buttonComponent({
        id: 'sync_time',
        name: 'Sync Time',
        icon: 'mdi:clock-sync',
        command: 'sync-time',
        payload_press: 'PRESS',
        enabled_by_default: false,
      }),
    );

    command('get-ct-power', {
      handler: ({ message, publishCallback }) => {
        if (message.toLowerCase() === 'true' || message === '1' || message === 'PRESS') {
          publishCallback(processCommand(CommandType.GET_CT_POWER));
        }
      },
    });
    advertise(
      [],
      buttonComponent({
        id: 'get_ct_power',
        name: 'Get CT Power',
        icon: 'mdi:current-ac',
        command: 'get-ct-power',
        payload_press: 'PRESS',
        enabled_by_default: false,
      }),
    );

    // Time period settings
    for (let i = 0; i < 10; i++) {
      const periodIndex = i;

      command(`time-period/${i}/enabled`, {
        handler: ({ updateDeviceState, message, publishCallback }) => {
          const enabled = message.toLowerCase() === 'true' || message === '1' || message === 'ON';

          updateDeviceState(state => {
            if (!state.timePeriods || !state.timePeriods[periodIndex]) {
              console.error(`Time period ${periodIndex} not found in device state`);
              return;
            }

            const timePeriods = [...(state.timePeriods || [])];
            timePeriods[periodIndex] = {
              ...timePeriods[periodIndex],
              enabled,
            };

            // Build the command parameters
            const params: CommandParams = { md: 1, nm: periodIndex };
            const period = timePeriods[periodIndex];

            params.bt = period.startTime;
            params.et = period.endTime;
            params.wk = period.weekday;
            params.vv = period.power;
            params.as = enabled ? 1 : 0;

            publishCallback(processCommand(CommandType.SET_TIME_PERIOD, params));

            return { timePeriods };
          });
        },
      });

      command(`time-period/${i}/start-time`, {
        handler: ({ updateDeviceState, message, publishCallback }) => {
          // Validate time format (HH:MM)
          if (!/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(message)) {
            console.error('Invalid start time format (should be HH:MM):', message);
            return;
          }

          const [hours, minutes] = message.split(':').map(part => parseInt(part, 10));

          updateDeviceState(state => {
            if (!state.timePeriods || !state.timePeriods[periodIndex]) {
              console.error(`Time period ${periodIndex} not found in device state`);
              return;
            }

            const timePeriods = [...(state.timePeriods || [])];
            timePeriods[periodIndex] = {
              ...timePeriods[periodIndex],
              startTime: `${hours}:${minutes.toString().padStart(2, '0')}`,
            };

            // Build the command parameters
            const params: CommandParams = { md: 1, nm: periodIndex };
            const period = timePeriods[periodIndex];

            params.bt = period.startTime;
            params.et = period.endTime;
            params.wk = period.weekday;
            params.vv = period.power;
            params.as = period.enabled ? 1 : 0;

            publishCallback(processCommand(CommandType.SET_TIME_PERIOD, params));

            return { timePeriods };
          });
        },
      });

      command(`time-period/${i}/end-time`, {
        handler: ({ updateDeviceState, message, publishCallback }) => {
          // Validate time format (HH:MM)
          if (!/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(message)) {
            console.error('Invalid end time format (should be HH:MM):', message);
            return;
          }

          const [hours, minutes] = message.split(':').map(part => parseInt(part, 10));

          updateDeviceState(state => {
            if (!state.timePeriods || !state.timePeriods[periodIndex]) {
              console.error(`Time period ${periodIndex} not found in device state`);
              return;
            }

            const timePeriods = [...(state.timePeriods || [])];
            timePeriods[periodIndex] = {
              ...timePeriods[periodIndex],
              endTime: `${hours}:${minutes.toString().padStart(2, '0')}`,
            };

            // Build the command parameters
            const params: CommandParams = { md: 1, nm: periodIndex };
            const period = timePeriods[periodIndex];

            params.bt = period.startTime;
            params.et = period.endTime;
            params.wk = period.weekday;
            params.vv = period.power;
            params.as = period.enabled ? 1 : 0;

            publishCallback(processCommand(CommandType.SET_TIME_PERIOD, params));

            return { timePeriods };
          });
        },
      });

      command(`time-period/${i}/power`, {
        handler: ({ updateDeviceState, message, publishCallback }) => {
          const power = parseInt(message, 10);
          if (isNaN(power) || power < 0) {
            console.error('Invalid power value:', message);
            return;
          }

          updateDeviceState(state => {
            if (!state.timePeriods || !state.timePeriods[periodIndex]) {
              console.error(`Time period ${periodIndex} not found in device state`);
              return;
            }

            const timePeriods = [...(state.timePeriods || [])];
            timePeriods[periodIndex] = {
              ...timePeriods[periodIndex],
              power,
            };

            // Build the command parameters
            const params: CommandParams = { md: 1, nm: periodIndex };
            const period = timePeriods[periodIndex];

            params.bt = period.startTime;
            params.et = period.endTime;
            params.wk = period.weekday;
            params.vv = period.power;
            params.as = period.enabled ? 1 : 0;

            publishCallback(processCommand(CommandType.SET_TIME_PERIOD, params));

            return { timePeriods };
          });
        },
      });

      command(`time-period/${i}/weekday`, {
        handler: ({ updateDeviceState, message, publishCallback }) => {
          if (!/^[0-6]*$/.test(message)) {
            console.error(
              'Invalid weekday value (should be a string only consisting of numbers 0-6):',
              message,
            );
            return;
          }
          const weekday = weekdaySetToBitMask(message as WeekdaySet);

          updateDeviceState(state => {
            if (!state.timePeriods || !state.timePeriods[periodIndex]) {
              console.error(`Time period ${periodIndex} not found in device state`);
              return;
            }

            const timePeriods = [...(state.timePeriods || [])];
            timePeriods[periodIndex] = {
              ...timePeriods[periodIndex],
              weekday: bitMaskToWeekdaySet(weekday),
            };

            // Build the command parameters
            const params: CommandParams = { md: 1, nm: periodIndex };
            const period = timePeriods[periodIndex];

            params.bt = period.startTime;
            params.et = period.endTime;
            params.wk = weekdaySetToBitMask(period.weekday);
            params.vv = period.power;
            params.as = period.enabled ? 1 : 0;

            publishCallback(processCommand(CommandType.SET_TIME_PERIOD, params));

            return { timePeriods };
          });
        },
      });
    }

    // Transaction mode settings
    command('transaction-mode', {
      handler: ({ message, publishCallback }) => {
        try {
          const params = JSON.parse(message);
          if (!params.id || !params.in || !params.on) {
            console.error('Missing transaction mode parameters:', message);
            return;
          }

          publishCallback(
            processCommand(CommandType.SET_TIME_PERIOD, {
              md: 2,
              id: params.id,
              in: params.in,
              on: params.on,
            }),
          );
        } catch (error) {
          console.error('Invalid transaction mode data:', message, error);
        }
      },
    });
  });
}

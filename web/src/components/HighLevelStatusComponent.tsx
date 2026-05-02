import {Col, Row, Statistic} from "antd";
import {batteryFormatter, booleanFormatter, booleanFormatterInverted, stateRenderer} from "./utils.tsx";
import {useHighLevelStatus} from "../hooks/useHighLevelStatus.ts";
import {usePower} from "../hooks/usePower.ts";
import {useSettings} from "../hooks/useSettings.ts";
import {useThemeMode} from "../theme/ThemeContext.tsx";

export function HighLevelStatusComponent() {
    const {colors} = useThemeMode();
    const {highLevelStatus} = useHighLevelStatus()
    const power = usePower()
    const {settings} = useSettings()
    const estimateRemainingChargingTime = () => {
        if (!power.BatteryVoltageAdc || !power.ChargeCurrent || power.ChargeCurrent == 0) {
            return "∞"
        }
        let capacity = (settings["OM_BATTERY_CAPACITY_MAH"] ?? "3000.0");
        let full = (settings["OM_BATTERY_FULL_VOLTAGE"] ?? "28.0");
        let empty = (settings["OM_BATTERY_EMPTY_VOLTAGE"] ?? "23.0");
        if (!capacity || !full || !empty) {
            return "∞"
        }
        const estimatedAmpsPerVolt = parseFloat(capacity) / (parseFloat(full) - parseFloat(empty))
        let estimatedRemainingAmps = (parseFloat(full) - (power.BatteryVoltageAdc ?? 0)) * estimatedAmpsPerVolt;
        if (estimatedRemainingAmps < 10) {
            return "∞"
        }
        let remaining = estimatedRemainingAmps / ((power.ChargeCurrent ?? 0) * 1000)
        if (remaining < 0) {
            return "∞"
        }
        return Date.now() + remaining * (1000 * 60 * 60)
    };

    const batteryPercent = highLevelStatus.BatteryPercent??0;
    return <Row gutter={[16, 16]}>
        <Col lg={6} xs={12}><Statistic title="State" valueStyle={{color: colors.primary}}
                                       value={stateRenderer(highLevelStatus.StateName)}/></Col>
        <Col lg={6} xs={12}><Statistic title="GPS" precision={2}
                                       value={(highLevelStatus.GpsQualityPercent ?? 0) * 100}
                                       suffix={"%"}/></Col>
        <Col lg={6} xs={12}><Statistic title="Battery" value={batteryPercent * 100}
                                       formatter={batteryFormatter}/></Col>
        <Col lg={6} xs={12}>{highLevelStatus.IsCharging ?
            <Statistic.Countdown title="Charge ETA" format={"HH:mm"}
                                       value={estimateRemainingChargingTime()}/> :
            <Statistic title="Charge ETA" value="--:--"/>}
        </Col>
        <Col lg={6} xs={12}><Statistic title="Charging" value={highLevelStatus.IsCharging ? "Yes" : "No"}
                                       formatter={booleanFormatter}/></Col>
        <Col lg={6} xs={12}><Statistic title="Emergency" value={highLevelStatus.Emergency ? "Yes" : "No"}
                                       formatter={booleanFormatterInverted}/></Col>
    </Row>;
}

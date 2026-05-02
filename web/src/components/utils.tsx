import {CheckCircleTwoTone, CloseCircleTwoTone} from "@ant-design/icons";
import {Progress} from "antd";
import {COLORS} from "../theme/colors.ts";
import Battery from "./Battery.tsx";

export const booleanFormatter = (value: any) => (value === "On" || value === "Yes") ?
    <CheckCircleTwoTone twoToneColor={COLORS.primary}/> : <CloseCircleTwoTone
        twoToneColor={COLORS.danger}/>;
export const booleanFormatterInverted = (value: any) => (value === "On" || value === "Yes") ?
    <CheckCircleTwoTone twoToneColor={COLORS.danger}/> : <CloseCircleTwoTone
        twoToneColor={COLORS.primary}/>;
export const stateRenderer = (value: string | undefined) => {
    switch (value) {
        case "IDLE":
            return "Idle"
        case "MOWING":
            return "Mowing"
        case "DOCKING":
            return "Docking"
        case "UNDOCKING":
            return "Undocking"
        case "AREA_RECORDING":
            return "Area Recording"
        default:
            return value ?? "Offline"
    }
};

export const batteryFormatter = (batteryPercent: any) => {
    return <Battery size={32} batteryPercent={batteryPercent} style={{color: batteryPercent > 50 ? COLORS.primary : (batteryPercent > 20 ? COLORS.warning : COLORS.danger), fontSize: 24}} /> ;
}

export const progressFormatter = (value: any) => {
    return <Progress steps={3} percent={value} size={25} showInfo={false} strokeColor={COLORS.primary}/>
};

export const progressFormatterSmall = (value: any) => {
    return <Progress steps={3} percent={value} size={11} showInfo={false} strokeColor={COLORS.primary}/>
};

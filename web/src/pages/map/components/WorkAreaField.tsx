import { MapArea } from "../../../types/ros";
import { Form, Input } from "antd";

export const WorkAreaFields = ({
    area,
    setArea,
}: {
    area: MapArea;
    setArea: (area: MapArea) => void;
}) => {
    return (
        <>
            <Form.Item label="Nr of outlines (empty is global)">
                <Input
                    key="outlinecount"
                    placeholder="e.g. 2"
                    type="number"
                    value={area?.OutlineCount}
                    onChange={(e) =>
                        setArea({
                            ...area,
                            OutlineCount: parseInt(e.target.value),
                        })
                    }
                    autoFocus
                />
            </Form.Item>
            <Form.Item label="Nr of outlines overlap (empty is global)">
                <Input
                    key="outlineoverlapcount"
                    placeholder="e.g. 2"
                    type="number"
                    value={area?.OutlineOverlapCount}
                    onChange={(e) =>
                        setArea({
                            ...area,
                            OutlineOverlapCount: parseInt(e.target.value),
                        })
                    }
                    autoFocus
                />
            </Form.Item>
            <Form.Item label="Outline Offset">
                <Input
                    key="outlineoffset"
                    step={0.01}
                    placeholder="e.g. 0.15"
                    type="number"
                    value={area?.OutlineOffset}
                    onChange={(e) =>
                        setArea({
                            ...area,
                            OutlineOffset: e.target.value===""?0: parseFloat(e.target.value),
                        })
                    }
                    autoFocus
                />
            </Form.Item>
            <Form.Item label="Angle (empty is global)">
                <Input
                    key="angle"
                    placeholder="e.g. 2"
                    type="number"
                    value={area?.Angle}
                    onChange={(e) =>
                        setArea({ ...area, Angle: parseFloat(e.target.value) })
                    }
                    autoFocus
                />
            </Form.Item>
        </>
    );
};

import { Form, Input, Modal, Select, Switch } from "antd";
import { useEffect, useState } from "react";
import { MapArea } from "../../../types/ros";
import { FeatureTypeAreas } from "../utils/types";
import { WorkAreaFields } from "./WorkAreaField";

interface NewAreaModalProps {
    open: boolean;
    onSave: (area: MapArea, type: FeatureTypeAreas) => void;
    onCancel: () => void;
}

export const NewAreaModal = ({ open, onSave, onCancel }: NewAreaModalProps) => {
    const [area, setArea] = useState<MapArea>({});
    const [areaType, setAreaType] = useState<FeatureTypeAreas>("workarea");

    const onAreaTypeChange = (v: FeatureTypeAreas) => {
        setAreaType(v);
        setArea({} as MapArea);
    };

    useEffect(() => {
        if (open) setArea({Active:true} as MapArea);
    }, [open]);

    return (
        <Modal
            open={open}
            title="New area"
            okText="Add area"
            cancelText="Cancel"
            onOk={() => {
                onSave(area, areaType);
            }}
            onCancel={onCancel}
            destroyOnHidden
        >
            <Form layout="vertical" style={{ marginTop: 16 }}>
                <Form.Item label="Area type">
                    <Select
                        value={areaType}
                        onChange={onAreaTypeChange}
                        options={[
                            { value: "workarea", label: "Working Area" },
                            { value: "navigation", label: "Navigation Area" },
                            { value: "obstacle", label: "Obstacle" },
                        ]}
                    />
                </Form.Item>
                <Form.Item label="Area name (optional)">
                    <Input
                        placeholder="e.g. Front lawn"
                        value={area?.Name}
                        onChange={(e) =>
                            setArea({ ...area, Name: e.target.value })
                        }
                        autoFocus
                    />
                </Form.Item>
                <Form.Item label="Active">
                    <Switch value={area?.Active} onChange={(v) => setArea({ ...area, Active: v })} />
                </Form.Item>
                {areaType === "workarea" && (
                    <WorkAreaFields area={area} setArea={setArea} />
                )}
            </Form>
        </Modal>
    );
};

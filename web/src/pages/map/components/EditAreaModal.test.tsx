import {describe, it, expect, vi} from 'vitest';
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {EditAreaModal} from './EditAreaModal.tsx';
import {FeatureTypeWorkArea} from '../utils/types.ts';
import { MapArea } from '../../../types/ros.ts';

describe('EditAreaModal', () => {
    const area = {} as MapArea;
    area.Name = 'Garden';

    const defaultProps = {
        open: true,
        feature_type: 'workarea' as FeatureTypeWorkArea,
        area,
        onChange: vi.fn(),
        onSave: vi.fn(),
        onCancel: vi.fn(),
    };

    it('renders with area name in title', () => {
        render(<EditAreaModal {...defaultProps} />);
        expect(screen.getByText('Edit "Garden"')).toBeInTheDocument();
    });

    it('shows generic title when no name', () => {
        const noNameArea = {} as MapArea;
        render(<EditAreaModal {...defaultProps} area={noNameArea} />);
        expect(screen.getByText('Edit area')).toBeInTheDocument();
    });

    it('renders with area name in input for workarea', () => {
        render(<EditAreaModal {...defaultProps} />);
        expect(screen.getByDisplayValue('Garden')).toBeInTheDocument();
    });

    it('renders with mowing order for workarea', () => {
        render(<EditAreaModal {...defaultProps} />);
        expect(screen.getByDisplayValue('2')).toBeInTheDocument();
    });

    it('shows area type selector', () => {
        render(<EditAreaModal {...defaultProps} />);
        expect(screen.getByText('Mowing Area')).toBeInTheDocument();
    });

    it('hides name and mowing order for navigation type', () => {
        const navArea = {} as MapArea;
        render(<EditAreaModal {...defaultProps} feature_type={'navigation'} area={navArea} />);
        expect(screen.queryByDisplayValue('Garden')).not.toBeInTheDocument();
        expect(screen.queryByText('Mowing order')).not.toBeInTheDocument();
    });

    it('hides name and mowing order for obstacle type', () => {
        const obstArea = {} as MapArea;
        render(<EditAreaModal {...defaultProps} feature_type='obstacle' area={obstArea} />);
        expect(screen.queryByText('Area name')).not.toBeInTheDocument();
        expect(screen.queryByText('Mowing order')).not.toBeInTheDocument();
    });

    it('does not render when closed', () => {
        render(<EditAreaModal {...defaultProps} open={false} />);
        expect(screen.queryByText('Edit "Garden"')).not.toBeInTheDocument();
    });

    it('calls onSave when Save clicked', async () => {
        const onSave = vi.fn();
        const user = userEvent.setup();
        render(<EditAreaModal {...defaultProps} onSave={onSave} />);
        await user.click(screen.getByText('Save'));
        expect(onSave).toHaveBeenCalled();
    });

    it('calls onCancel when Cancel clicked', async () => {
        const onCancel = vi.fn();
        const user = userEvent.setup();
        render(<EditAreaModal {...defaultProps} onCancel={onCancel} />);
        await user.click(screen.getByText('Cancel'));
        expect(onCancel).toHaveBeenCalled();
    });

    it('calls onChange when name is edited', async () => {
        const onChange = vi.fn();
        const user = userEvent.setup();
        render(<EditAreaModal {...defaultProps} />);
        const input = screen.getByDisplayValue('Garden');
        await user.clear(input);
        await user.type(input, 'Back Yard');
        expect(onChange).toHaveBeenCalled();
    });
});

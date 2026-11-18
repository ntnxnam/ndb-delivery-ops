import React from 'react';
import { render, screen } from '@testing-library/react';
test('trivial', () => {
  const Comp = () => React.useState(0)[0] === 0 ? <div>ok</div> : null;
  render(<Comp />);
  expect(screen.getByText('ok')).toBeTruthy();
});
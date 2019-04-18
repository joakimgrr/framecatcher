const framecatch = require('../index');

jest.setTimeout(80000);

test('Matches similar videos correctly', async () => {
  // videoA and videoB are the same
  const result = await framecatch('./__tests__/footage/videoA.mp4', './__tests__/footage/videoB.mp4');
  expect(result.pass).toBe(true);
});

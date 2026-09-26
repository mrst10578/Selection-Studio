import {defineConfig,devices} from "@playwright/test";

export default defineConfig({
  testDir:"./qa",
  testMatch:"**/*.spec.mjs",
  timeout:30000,
  expect:{timeout:5000},
  fullyParallel:true,
  reporter:process.env.CI?"github":"list",
  use:{baseURL:"http://127.0.0.1:4173",trace:"retain-on-failure"},
  webServer:{
    command:"node qa/server.mjs",
    url:"http://127.0.0.1:4173/studio/",
    reuseExistingServer:!process.env.CI,
    timeout:30000
  },
  projects:[
    {name:"desktop-chromium",use:{...devices["Desktop Chrome"]}},
    {name:"mobile-chromium",use:{...devices["Pixel 7"]}}
  ]
});

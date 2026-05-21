import { createRouter, createWebHistory } from 'vue-router';

const router = createRouter({
  history: createWebHistory('/studio/'),
  routes: [
    {
      path: '/',
      name: 'dashboard',
      component: () => import('../views/DashboardPage.vue'),
    },
    {
      path: '/traces',
      name: 'traces',
      component: () => import('../views/TraceListPage.vue'),
    },
    {
      path: '/traces/:id',
      name: 'trace-detail',
      component: () => import('../views/TraceDetailPage.vue'),
    },
    {
      path: '/sessions',
      name: 'sessions',
      component: () => import('../views/SessionListPage.vue'),
    },
    {
      path: '/permissions',
      name: 'permissions',
      component: () => import('../views/PermissionsPage.vue'),
    },
  ],
});

export default router;

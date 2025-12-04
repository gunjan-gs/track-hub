
import { api } from '~/trpc/react';
import { useLocalStorage } from 'usehooks-ts';
import { useEffect } from 'react';

const useProject = () => {
       const {data:projects}= api.project.getProjects.useQuery();
       const [projectId,setProjectId]= useLocalStorage('dionysus-project-id', '');
       useEffect(() => {
         const first = projects?.[0];
         if (!projectId && first) {
           setProjectId(first.id);
         } else if (projectId && projects && !projects.some(p => p.id === projectId)) {
           setProjectId(first?.id ?? '');
         }
       }, [projectId, projects, setProjectId]);
       const project = projects?.find((project) => project.id === projectId);
       return {
        project,
        projects,
        projectId,
        setProjectId,
       };
}

export default useProject

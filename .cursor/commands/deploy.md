# deploy

---
alwaysApply: false
---

Here is the guide on how to deploy this project to production:

## Things to do locally

1) Login to ecr with following command: (don't change these commands, only use as it is)

```bash
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 390403864981.dkr.ecr.us-east-1.amazonaws.com
```

2) Build image locally:

```bash
docker buildx build --platform linux/amd64 -t kpi-bot . --load
```

3) Tag the image:

```bash
docker tag kpi-bot:latest 390403864981.dkr.ecr.us-east-1.amazonaws.com/kpi-bot:latest
```

4) Push the image to ECR:

```bash
docker push 390403864981.dkr.ecr.us-east-1.amazonaws.com/kpi-bot:latest
```

## Things to do in ec2 linux instance

**IMPORTANT**: Do NOT use interactive SSH sessions. Execute individual SSH commands one by one without leaving the local terminal.

EC2 instance ip: `ec2-user@ec2-3-83-184-223.compute-1.amazonaws.com`
KEY location: `/Users/creepy/dev/projects/loadhunter-ai/secret/loadhunter-aws.pem`

The EC2 instance path should be `/home/ec2-user/loadhunter` and contains docker-compose.yml with multiple projects.
You only need to pull and update project named `kpi-bot`.

Here are the SSH commands to execute individually:


1) login ecr

```bash
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 390403864981.dkr.ecr.us-east-1.amazonaws.com
```

2) open required folder

```bash
cd loadhunter
```

so when you do pwd, the path should be `/home/ec2-user/loadhunter`

3) pull image from ecr

```bash
docker-compose pull kpi-bot
```

yes container/image name is `kpi-bot` in docker-compose.yml

4) recreate the image with the updated one:

```bash
docker-compose up -d --force-recreate kpi-bot
```

5) clean up unused images, because we no longer need those once container is running, so we save space.

```bash
docker image prune -f
```

## CAUTIOUN

- THIS EC2 INSTANCE HOLDS A LOT OF OTHER PROJECT, DON'T EVER MESS WITH THEM, ONLY WORK WITH THE ASKED
- DON'T CHANGE COMMANDS ABOVE AND DON'T TRY TO RUN ANY OTHER COMMANDS THAT MAY CAUSE RISK.
- WHEN IN DOUBT OR UNEXPECTED MOMENTS HAPPEN, ALWAYS ASK USER WHAT TO DO, DON'T JUST BLINDLY CONTINUE 
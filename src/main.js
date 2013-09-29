var chem = require("chem");
var v = chem.vec2d;
var ani = chem.resources.animations;
var canvas = document.getElementById("game");
var engine = new chem.Engine(canvas);
var tmx = require('chem-tmx');

canvas.style.cursor = "none";

engine.buttonCaptureExceptions[chem.button.KeyF5] = true;

engine.showLoadProgressBar();
engine.start();
canvas.focus();

var GRAVITY = 0.2;

function startGame(map) {
  var levelBatch = new chem.Batch();
  var staticBatch = new chem.Batch();
  var player = new chem.Sprite(ani.roadieIdle, {
    batch: levelBatch,
    zOrder: 1,
  });
  var playerPos = v();
  var playerSize = v(15, 57);
  var crosshairSprite = new chem.Sprite(ani['cursor/mike'], {
    batch: staticBatch,
  });
  var playerVel = v(0,0);
  var platforms = [];
  var fpsLabel = engine.createFpsLabel();

  var playerStartSpeed = 5;
  var playerMaxSpeed = playerStartSpeed;
  var playerRunAcc = 0.25;
  var playerAirAcc = 0.15;
  var playerJumpVec = v(0,-6.5); //added ONCE
  var friction = 1.15;
  var grounded = false;
  var scroll = v(0, 0);

  //Enemies
  var spikeBalls = [];
  var weedClouds = [];
  var decorations = [];

  var projectiles = [];

  var directionFacing = 1;

  var bgImg = chem.resources.images['background.png'];
  var bgCrowd = chem.resources.images['background_crowd_loop.png'];
  var groundImg = chem.resources.images['ground_dry_dirt.png'];
  var maxScrollX = null;
  var groundY = engine.size.y - groundImg.height;

  var crowd = new chem.Sprite(ani.mobCloud1, {
    batch: levelBatch,
    pos: v(20, groundY),
  });
  var crowdLife = 100;
  var crowdRect = {pos: crowd.pos, size: v(50,900)};
  var crowdSpeed = 0.2;
  var crowdRotationSpeed = Math.PI / 400;
  var crowdDeathRadius = 320;

  var dying = false;

  var weaponIndex = 0;
  var weapons = [
    {
      name: "microphone",
      animation: ani.attack_mic,
      reload: 0,
      reloadAmt: 0.3,
      projectileSpeed: 10,
      projectileLife: 1,
      tripleShot: false,
      cursor: 'cursor/mike',
    },
    {
      name: "guitar",
      reload: 0,
      reloadAmt: 1.0,
      cursor: 'cursor/flyingv',
    },
    {
      name: "drums",
      animation: ani.attack_drum,
      reload: 0,
      reloadAmt: 0.4,
      projectileSpeed: 9,
      projectileLife: 1,
      cursor: 'cursor/drum',
    }
  ];
  
  
  var beamIsOn = false;
  var beam = null;

  updateCursor();

  engine.on('update', onUpdate);
  engine.on('draw', onDraw);
  engine.on('mousemove', onMouseMove);

  loadMap();

  function updateCursor() {
    var currentWeapon = weapons[weaponIndex];
    crosshairSprite.setAnimation(ani[currentWeapon.cursor]);
  }

  function playerRect() {
    return {
      pos: playerPos,
      size: playerSize,
    };
  }

  function onUpdate(dt, dx) {
    //CONTROLS
    var left = engine.buttonState(chem.button.KeyLeft) || engine.buttonState(chem.button.KeyA);
    var right = engine.buttonState(chem.button.KeyRight) || engine.buttonState(chem.button.KeyD);
    var jump = engine.buttonState(chem.button.KeyUp) || engine.buttonState(chem.button.KeyW) || engine.buttonState(chem.button.KeySpace);

    //Switch Weapons
    if (engine.buttonJustPressed(chem.button.KeyShift) || engine.buttonJustPressed(chem.button.MouseRight)) {
      weaponIndex = (weaponIndex + 1) % weapons.length;
      updateCursor();
    }

    //Update crowd position
    crowd.pos.x += crowdSpeed;
    crowd.rotation += crowdRotationSpeed;

    //crowd vs human
    if (playerPos.distance(crowd.pos) < crowdDeathRadius) {
      playerDie();
    }
    else if(crowdLife <= 0){
      crowdLife = 0;
      console.log("YOU WIN!!!");
    }
    

    //WEED cloud collision
    var inAnyWeedCloud = false;
    for(var i=0;i<weedClouds.length;i++){
      var cloud = weedClouds[i];
      var cloudRect = {pos: cloud.pos.plus(v(100,30)), size: v(230,100)};

      if(rectCollision(player,cloudRect)) {
        inAnyWeedCloud = true;
      }
    }
    playerMaxSpeed = inAnyWeedCloud ? 2.5 : 5;

    weaponUpdate(dt);

    spikeBallUpdate(dt, dx);

    //bullet movement
    for (i = 0; i < projectiles.length; i += 1) {
      var projectile = projectiles[i];
      projectile.sprite.pos.add(projectile.vel.scaled(dx));
      projectile.life -= dt;
      
      if(projectile.sprite.pos.distance(crowd.pos) < crowdDeathRadius){
        crowdLife -= 1;
        console.log(crowdLife);
        projectile.life = -10;
      }

      if (projectile.life <= 0) {
        projectiles[i].sprite.delete();
        projectiles.splice(i,1);
        i--;
      }
    }

    // rotate the beam
    if(beamIsOn){
      var origPoint = playerPos.offset(6, 10);
      var aimVec = engine.mousePos.plus(scroll).minus(origPoint).normalize();

      beam.pos = origPoint;//aimVec.scaled(10).plus(origPoint);

      var angleDiff = angleSubtract(aimVec.angle(),beam.rotation);

      //console.log("angleToMouse: " + aimVec.angle());
      if(angleDiff >Math.PI/90){
        beam.rotation += 0.005;
      }else if(angleDiff<-Math.PI/90){
        beam.rotation -= 0.005;
      }
    }

    //Player COLISION
    var newPlayerPos = playerPos.plus(playerVel.scaled(dx));
    grounded = false;
    var newPr = {pos: newPlayerPos, size: playerSize};
    for (i = 0; i < platforms.length; i += 1) {
      var platform = platforms[i];
      if (rectCollision(newPr, platform)) {
        var outVec = resolveMinDist(newPr, platform);
        if (Math.abs(outVec.x) > Math.abs(outVec.y)) {
          var xDiff = resolveX(outVec.x, newPr, platform);
          newPlayerPos.x += xDiff;
          playerVel.x = 0;
        } else {
          var yDiff = resolveY(outVec.y, newPr, platform);
          newPlayerPos.y += yDiff;
          playerVel.y = 0;
        }
        newPr = {pos: newPlayerPos, size: playerSize};
        if (outVec.y < 0) {
          grounded = true;
        }
      }
    }
    if (newPlayerPos.y + playerSize.y >= groundY) {
      newPlayerPos.y = groundY - playerSize.y;
      playerVel.y = 0;
      grounded = true;
    }
    playerPos = newPlayerPos;

    scroll = playerPos.minus(engine.size.scaled(0.5));
    if (scroll.x < 0) scroll.x = 0;
    scroll.y = 0;
    maxScrollX = map.width - engine.size.x / 2;
    if (scroll.x > maxScrollX) scroll.x = maxScrollX;

    if (left && !dying) {
      if(grounded)
        playerVel.x -= playerRunAcc;
      else
        playerVel.x -= playerAirAcc;
    }
    if (right && !dying) {
      if(grounded)
        playerVel.x += playerRunAcc;
      else
        playerVel.x += playerAirAcc;
    }
    if (jump && !dying) {
      if(grounded){
        playerVel.add(playerJumpVec);
        grounded = false;
      }
    }

    //check MAX SPEED
    if(playerVel.x < -playerMaxSpeed){
        playerVel.x = -playerMaxSpeed;
    }
    if(playerVel.x > playerMaxSpeed){
      playerVel.x = playerMaxSpeed;
    }
    
    //Apply FRICTION
    if(grounded && ((!left && !right) || dying)){
      if(Math.abs(playerVel.x) < 0.25){
        playerVel.x = 0;
      } else{
        playerVel.scale(1/friction);
      }
    }

    // gravity
    playerVel.y += GRAVITY * dx;

    var wantedAni = getPlayerAnimation();
    if (player.animation !== wantedAni) {
      player.setAnimation(wantedAni);
      player.setFrameIndex(0);
    }

    directionFacing = sign(playerVel.x) || directionFacing;
    player.scale.x = directionFacing;
    player.pos = playerPos.clone();
    // compensate for offset
    if (directionFacing < 0) {
      player.pos.x += playerSize.x;
    }

    function getPlayerAnimation() {
      if (dying) {
        return ani.roadieDeath;
      } else if (grounded) {
        if (Math.abs(playerVel.x) > 0) {
          if (left&&playerVel.x<=0 || right&&playerVel.x>=0) {
            return ani.roadieRun;
          } else {
            return ani.roadieSlide;
          }
        } else {
          return ani.roadieIdle;
        }
      } else if (playerVel.y < 0) {
        return ani.roadieJumpUp;
      } else {
        return ani.roadieJumpDown;
      }
    }

  }

  function spikeBallUpdate(dt, dx) {
    //spike balls
    var i;
    for(i=0;i<spikeBalls.length; i++){
      var ball = spikeBalls[i];

      var ballRect = {
            pos: ball.pos.plus(v(-12,-32)),
            size: v(24,65)
      }
      
      var ballColliding = false;
      
      
      //check against player
      if(rectCollision(player,ballRect)){
        ball.sprite.delete();
        spikeBalls.splice(i,1);
        i--;
        continue;
      }
      
      if(!ballColliding){
        //move it!
        if(ball.type == "vertical"){
        }
        else if(ball.type == "horizontal"){
        }
        else if(ball.type == "rotate"){
        }
        else if(ball.type == "attack"){
          if(ball.triggerOn){
            ball.pos.x -= ball.speed;
          }
          else{
            var xDist = Math.abs(ball.pos.x - playerPos.x);
            var yDist = Math.abs(ball.pos.y - playerPos.y);

            if(xDist < engine.size.x) //&& yDist < 50)
              ball.triggerOn = true;
          }
        }
      }

      if(!ballColliding){
        for (j = 0; j < projectiles.length; j += 1) {
          if(rectCollision(ballRect,projectiles[j].sprite)){
            ball.sprite.delete();
            spikeBalls.splice(i,1);
            i--;

            projectiles[j].sprite.delete();
            projectiles.splice(j,1);
            break;
          }
        }
      }
    }
  }

  function weaponUpdate(dt) {
    var currentWeapon = weapons[weaponIndex];
    if (currentWeapon.reload <= 0) {
      if (engine.buttonState(chem.button.MouseLeft) && !dying) {
        var origPoint = playerPos.offset(6, 10);
        var aimVec = engine.mousePos.plus(scroll).minus(origPoint).normalize();

        if(currentWeapon.name === 'microphone'){
          //Microphone
          projectiles.push({
            sprite: new chem.Sprite(currentWeapon.animation, {
              batch: levelBatch,
              pos: aimVec.scaled(10).plus(origPoint),
              rotation: aimVec.angle(),
            }),
            vel: aimVec.scaled(currentWeapon.projectileSpeed).plus(playerVel),
            life: currentWeapon.projectileLife,
          });

          if(currentWeapon.tripleShot){
            var angle2 = aimVec.angle()+Math.PI/8;
            var angle3 = angle2-Math.PI/4;
            var aimVec2 = v.unit(angle2);
            var aimVec3 = v.unit(angle3);

            //add a TRIPLE SHOT
            projectiles.push({
              sprite: new chem.Sprite(currentWeapon.animation, {
                batch: levelBatch,
                pos: aimVec2.scaled(10).plus(origPoint),
                rotation: aimVec2.angle(),
              }),
              vel: aimVec2.scaled(currentWeapon.projectileSpeed).plus(playerVel),
              life: currentWeapon.projectileLife,
            });

            projectiles.push({
              sprite: new chem.Sprite(currentWeapon.animation, {
                batch: levelBatch,
                pos: aimVec3.scaled(10).plus(origPoint),
                rotation: aimVec3.angle(),
              }),
              vel: aimVec3.scaled(currentWeapon.projectileSpeed).plus(playerVel),
            });
          }
        }else if(currentWeapon.name === 'guitar'){
          //GUITAR
          beam = new chem.Sprite(ani.guitarBeam, {
                  batch: levelBatch,
                  pos: aimVec.scaled(10).plus(origPoint),
                  rotation: aimVec.angle(),
          });
          beamIsOn = true;
          setTimeout(function(){
            beam.delete();
            beamIsOn = false;
          },750);
        }else if(currentWeapon.name === 'drums'){
          //var aimVec = v(1,-1).normalize();
          var angle = 0;

          for(var i=0; i<16; i++){
            angle = i*Math.PI/8
            aimVec = v.unit(angle);
            projectiles.push({
              sprite: new chem.Sprite(currentWeapon.animation, {
                batch: levelBatch,
                pos: aimVec.scaled(10).plus(origPoint),
                rotation: aimVec.angle(),
              }),
              vel: aimVec.scaled(currentWeapon.projectileSpeed).plus(playerVel),
              life: currentWeapon.projectileLife,
            });
          }
        }

        currentWeapon.reload = currentWeapon.reloadAmt;
      }
    } else {
      currentWeapon.reload -= dt;
    }
  }

  function onDraw(context) {
    var bgOffsetX = scroll.x / maxScrollX * (bgImg.width - engine.size.x);
    context.drawImage(bgImg, bgOffsetX, 0, engine.size.x, bgImg.height, 0, 0, engine.size.x, bgImg.height);

    var crowdOffsetX = (scroll.x * 0.8) % bgCrowd.width;
    context.translate(-crowdOffsetX, 0);
    context.drawImage(bgCrowd, 0, engine.size.y - groundImg.height - bgCrowd.height);
    context.drawImage(bgCrowd, bgCrowd.width, engine.size.y - groundImg.height - bgCrowd.height);

    context.setTransform(1, 0, 0, 1, 0, 0); // load identity
    context.translate(-scroll.x, -scroll.y);
    levelBatch.draw(context);

    var groundOffsetX = scroll.x % groundImg.width;
    context.setTransform(1, 0, 0, 1, 0, 0); // load identity
    context.translate(-groundOffsetX, 0);
    context.drawImage(groundImg, 0, engine.size.y - groundImg.height);
    context.drawImage(groundImg, groundImg.width, engine.size.y - groundImg.height);

    // static
    context.setTransform(1, 0, 0, 1, 0, 0); // load identity
    staticBatch.draw(context);
    fpsLabel.draw(context);
  }

  function playerDie() {
    dying = true;
  }

  function onMouseMove(pos, button) {
    crosshairSprite.pos = pos.clone();
  }

  function loadMap() {
    map.layers.forEach(function(layer) {
      if (layer.type === 'object') {
        layer.objects.forEach(loadMapObject);
      }
    });
  }

  function loadMapObject(obj) {
    var pos = v(obj.x, obj.y);
    var size = v(obj.width, obj.height);
    var img = chem.resources.images[obj.properties.image];
    switch (obj.name) {
      case 'Start':
        playerPos = v(pos.x + size.x / 2, pos.y + size.y);
        break;
      case 'Platform':
        platforms.push({
          pos: pos,
          size: size,
          sprite: new chem.Sprite(chem.Animation.fromImage(img), {
            batch: levelBatch,
            pos: pos,
            scale: size.divBy(v(img.width, img.height)),
          }),
        });
        break;
      case 'Skull':
        spikeBalls.push({
          pos: pos,
          size: size,
          sprite: new chem.Sprite(ani.skullAttack, {
            batch: levelBatch,
            pos: pos,
          }),
          type: obj.type,
          range: parseInt(obj.properties.range, 10),
          speed: parseInt(obj.properties.speed, 10),
          triggerOn: false,
        });
        break;
      case 'Weed':
        weedClouds.push({
          pos: pos,
          size: size,
          sprite: new chem.Sprite(ani.weedSmoke, {
            batch: levelBatch,
            pos: pos,
          }),
        });
        break;
      case 'Decoration':
        decorations.push(new chem.Sprite(chem.Animation.fromImage(img), {
          batch: levelBatch,
          pos: pos,
          zOrder: parseInt(obj.properties.zOrder || 0, 10),
        }));
        break;
    }
  }
}

chem.resources.on('ready', function() {
  tmx.load(chem, "level.tmx", function(err, map) {
    if (err) throw err;
    startGame(map);
  });
});

function sign(n) {
  if (n < 0) {
    return -1;
  } else if (n > 0) {
    return 1;
  } else {
    return 0;
  }
}

function rectCollision(rect1, rect2) {
  return !(rect1.pos.x >= rect2.pos.x + rect2.size.x || rect1.pos.y >= rect2.pos.y + rect2.size.y ||
           rect2.pos.x >= rect1.pos.x + rect1.size.x || rect2.pos.y >= rect1.pos.y + rect1.size.y ||
           rect1.pos.x + rect1.size.x < rect2.pos.x || rect1.pos.y + rect1.size.y < rect2.pos.y ||
           rect2.pos.x + rect2.size.x < rect1.pos.x || rect2.pos.y + rect2.size.y < rect1.pos.y);
}

function rotateRectangle(rect1, rect2, rotation){
  //find 4 relative corner points of rect2
//  var relPosX = rect2.pos.minus(
  
  //rotate 4 points of rect2 around rect1 anchor
  
  //test 4 points against rotated rectangle.
}

function resolveX(xSign, dynamicRect, staticRect) {
  if (xSign < 0) {
    return staticRect.pos.x - (dynamicRect.pos.x + dynamicRect.size.x);
  } else {
    return staticRect.pos.x + staticRect.size.x - dynamicRect.pos.x + 1;
  }
}

function resolveY(ySign, dynamicRect, staticRect) {
  if (ySign < 0) {
    return staticRect.pos.y - (dynamicRect.pos.y + dynamicRect.size.y);
  } else {
    return staticRect.pos.y + staticRect.size.y - dynamicRect.pos.y + 1;
  }
}

function angleSubtract(left, right){
  var delta = left - right;
  if(delta > Math.PI) delta -= 2*Math.PI;
  if(delta < -Math.PI) delta += 2*Math.PI;
  return delta;
}

function resolveMinDist(rect1, rect2) {
  var minDist = Infinity;
  var outVec;

  var dist1 = Math.abs(rect1.pos.x - (rect2.pos.x + rect2.size.x));
  if (dist1 < minDist) {
    minDist = dist1;
    outVec = v(1, 0);
  }

  dist1 = Math.abs(rect1.pos.x + rect1.size.x - rect2.pos.x);
  if (dist1 < minDist) {
    minDist = dist1;
    outVec = v(-1, 0);
  }

  dist1 = Math.abs(rect1.pos.y - (rect2.pos.y + rect2.size.y));
  if (dist1 < minDist) {
    minDist = dist1;
    outVec = v(0, 1);
  }

  dist1 = Math.abs(rect1.pos.y + rect1.size.y - rect2.pos.y);
  if (dist1 < minDist) {
    minDist = dist1;
    outVec = v(0, -1);
  }

  return outVec;
}
